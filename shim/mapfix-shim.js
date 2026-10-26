/*
 * mapfix-shim.js: a google.maps compatibility layer on top of Leaflet, for the Map module
 * of Lightroom 6 / Lightroom CC 2015.
 *
 * Lightroom 6's map page was written for the Google Maps JavaScript API v3 (2011-2017).
 * Google's current API no longer runs in Lightroom's embedded Chromium 51. This file
 * provides the subset of google.maps that Lightroom's map page, MarkerClusterer and
 * KeyDragZoom use, implemented with Leaflet and OpenStreetMap / Esri tiles. No API key needed.
 *
 * The API surface implemented here is documented in shim-api-inventory.md.
 *
 * RULES FOR THIS FILE
 *  - ES5 only: it must run in Chromium 51. No let/const, arrow functions, classes,
 *    template strings, default parameters, or newer built-ins.
 *  - Prototype methods must be ENUMERABLE (plain assignment). Adobe's MarkerClusterer
 *    "inherits" from OverlayView by copying its prototype with for...in.
 *  - Internal state lives in non-enumerable properties and is created lazily, because
 *    MarkerClusterer instances get OverlayView methods without the constructor running.
 *
 * Loading: <script src="mapfix-shim.js?callback=initialize"> defines google.maps right away,
 * loads Leaflet, then calls window.initialize() (like Google's loader). Without a callback
 * parameter only the parts that don't need Leaflet are usable. A "v=" parameter can select
 * another release or a self-hosted copy, see requestedShimUrl(). If the shim or Leaflet
 * can't be loaded, a JavaScript error is raised so that Lightroom shows "Map is offline".
 *
 * Status: Phase 2 steps 1-4: value types, MVC and events, Map, OverlayView, Marker,
 * Circle, Polyline, Rectangle, Geocoder (Nominatim). MaxZoomService and ElevationService
 * are intentionally absent (Lightroom checks for them).
 *
 * Leaflet (loaded at runtime, not part of this file) is (c) Volodymyr Agafonkin, BSD-2-Clause.
 */
(function (window) {
	"use strict";

	var document = window.document;

	var SHIM_VERSION = "1.0.1";
	// Released versions of this file, for api_version = "v1.2.3" in Lightroom's config.lua
	var RELEASE_URL = "https://cdn.jsdelivr.net/gh/astuder/lightroom-map-fix@{version}/shim/mapfix-shim.js";

	// Must be read while this script runs (document.currentScript is only set then).
	var SELF_SRC = currentScriptSrc();

	// If Lightroom asks for another shim (config.lua: locationModule.api_version), load that one
	// instead and stop here, before anything is defined. See loadRequestedShim() at the end.
	if (document && loadRequestedShim(SELF_SRC)) return;

	// -----------------------------------------------------------------------------------------
	// Configuration (can be overridden with window.LR_MAP_SHIM_CONFIG before this file loads)
	// -----------------------------------------------------------------------------------------

	var OSM = "\u00a9 OpenStreetMap contributors";
	var OSM_SHORT = "\u00a9 OSM contributors";
	var ESRI = "Tiles \u00a9 Esri \u2014 Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
	var ESRI_SHORT = "\u00a9 Esri, Maxar, Earthstar Geographics";
	var ESRI_BASE = "https://server.arcgisonline.com/ArcGIS/rest/services/";

	var DEFAULT_CONFIG = {
		leaflet: {
			js: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
			jsIntegrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
			css: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
			cssIntegrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=",
			timeout: 30000
		},
		// Map types: Google id -> name, max zoom and tile layers (drawn bottom to top).
		// Attribution is plain text: links would navigate Lightroom's map view away.
		mapTypes: {
			roadmap: {
				name: "Map", maxZoom: 19,
				layers: [ { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19, attribution: OSM, shortAttribution: OSM_SHORT } ]
			},
			satellite: {
				name: "Satellite", maxZoom: 19,
				layers: [ { url: ESRI_BASE + "World_Imagery/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 19, attribution: ESRI, shortAttribution: ESRI_SHORT } ]
			},
			hybrid: {
				name: "Hybrid", maxZoom: 19,
				layers: [
					{ url: ESRI_BASE + "World_Imagery/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 19, attribution: ESRI, shortAttribution: ESRI_SHORT },
					{ url: ESRI_BASE + "Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 19 },
					{ url: ESRI_BASE + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 19 }
				]
			},
			terrain: {
				name: "Terrain", maxZoom: 17,
				layers: [ { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", subdomains: "abc", maxNativeZoom: 17,
					attribution: OSM + ", SRTM | Map style: \u00a9 OpenTopoMap (CC-BY-SA)",
					shortAttribution: OSM_SHORT + ", SRTM | \u00a9 OpenTopoMap" } ]
			},
			lrLight: {
				name: "Light", maxZoom: 19,
				layers: [ { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19, attribution: OSM,
					shortAttribution: OSM_SHORT, className: "lrshim-light" } ]
			},
			lrDark: {
				name: "Dark", maxZoom: 19,
				layers: [ { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19, attribution: OSM,
					shortAttribution: OSM_SHORT, className: "lrshim-dark" } ]
			}
		},
		css: ".lrshim-light { -webkit-filter: grayscale(0.85) brightness(1.08) contrast(0.9); filter: grayscale(0.85) brightness(1.08) contrast(0.9); }\n" +
			".lrshim-dark { -webkit-filter: invert(1) hue-rotate(180deg) grayscale(0.7) brightness(0.85) contrast(0.9); " +
			"filter: invert(1) hue-rotate(180deg) grayscale(0.7) brightness(0.85) contrast(0.9); }\n" +
			".lrshim-inner .leaflet-control-attribution { font-size: 10px; }\n" +
			// small maps (Lightroom's navigator): one short line
			".lrshim-compact .leaflet-control-attribution { font-size: 8px; line-height: 1.3; padding: 0 3px; " +
			"white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; box-sizing: border-box; }\n",
		compactWidth: 400,      // maps narrower than this get the short attribution
		// Geocoder: OpenStreetMap's Nominatim (https://operations.osmfoundation.org/policies/nominatim/)
		geocoder: {
			url: "https://nominatim.openstreetmap.org/",
			email: "",               // Nominatim asks heavy users to identify themselves
			minInterval: 1100,       // usage policy: at most 1 request per second
			limit: 5
		},
		attributionPrefix: "Leaflet",
		maxLatitude: 85.0511287798
	};

	function merge(target, source) {
		for (var key in source) {
			if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
			var value = source[key];
			if (value && typeof value === "object" && !(value instanceof Array) &&
					target[key] && typeof target[key] === "object" && !(target[key] instanceof Array)) {
				merge(target[key], value);
			} else {
				target[key] = value;
			}
		}
		return target;
	}

	var config = merge(merge({}, DEFAULT_CONFIG), window.LR_MAP_SHIM_CONFIG || {});

	// -----------------------------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------------------------

	function hidden(obj, name, value) {
		Object.defineProperty(obj, name, { value: value, enumerable: false, writable: true, configurable: true });
		return value;
	}

	// lazily created, non-enumerable internal state
	function internal(obj, name, factory) {
		if (!Object.prototype.hasOwnProperty.call(obj, name)) hidden(obj, name, factory());
		return obj[name];
	}

	// Child inherits Parent; prototype methods stay enumerable, "constructor" does not.
	function inherits(Child, Parent) {
		Child.prototype = Object.create(Parent.prototype);
		hidden(Child.prototype, "constructor", Child);
	}

	function extend(proto, methods) {
		for (var key in methods) {
			if (Object.prototype.hasOwnProperty.call(methods, key)) proto[key] = methods[key];
		}
	}

	function capitalize(s) {
		return s.charAt(0).toUpperCase() + s.substr(1);
	}

	function toNumber(v) {
		return typeof v === "number" ? v : parseFloat(v);
	}

	function clamp(v, lo, hi) {
		return v < lo ? lo : (v > hi ? hi : v);
	}

	function wrapLng(lng) {
		if (lng < -180 || lng > 180) lng = ((lng + 180) % 360 + 360) % 360 - 180;
		return lng;
	}

	function warn(message) {
		if (window.console && window.console.warn) window.console.warn("[mapfix-shim] " + message);
	}

	var maps = {};

	// =========================================================================================
	// Step 1: value types
	// =========================================================================================

	function LatLng(lat, lng, noWrap) {
		if (lat && typeof lat === "object") {
			// LatLngLiteral or LatLng
			noWrap = lng;
			lng = typeof lat.lng === "function" ? lat.lng() : lat.lng;
			lat = typeof lat.lat === "function" ? lat.lat() : lat.lat;
		}
		lat = toNumber(lat);
		lng = toNumber(lng);
		if (!noWrap) {
			lat = clamp(lat, -90, 90);
			lng = wrapLng(lng);
		}
		hidden(this, "lat_", lat);
		hidden(this, "lng_", lng);
	}
	extend(LatLng.prototype, {
		lat: function () { return this.lat_; },
		lng: function () { return this.lng_; },
		equals: function (other) {
			return !!other && Math.abs(this.lat_ - other.lat()) <= 1e-9 && Math.abs(this.lng_ - other.lng()) <= 1e-9;
		},
		toString: function () { return "(" + this.lat_ + ", " + this.lng_ + ")"; },
		toUrlValue: function (precision) {
			var p = precision === undefined ? 6 : precision;
			return (+this.lat_.toFixed(p)) + "," + (+this.lng_.toFixed(p));
		},
		toJSON: function () { return { lat: this.lat_, lng: this.lng_ }; }
	});

	function toLatLng(v) {
		if (v == null) return null;
		return v instanceof LatLng ? v : new LatLng(v);
	}

	/*
	 * LatLngBounds keeps a latitude interval [south, north] and a longitude interval
	 * [west, east]. west > east means the bounds cross the antimeridian (like Google).
	 */
	function LatLngBounds(sw, ne) {
		hidden(this, "south_", 1);
		hidden(this, "north_", -1);   // empty
		hidden(this, "west_", 180);
		hidden(this, "east_", -180);  // empty
		if (sw && typeof sw.west === "number") {
			// LatLngBoundsLiteral
			ne = { lat: sw.north, lng: sw.east };
			sw = { lat: sw.south, lng: sw.west };
		}
		if (sw) {
			sw = toLatLng(sw);
			ne = toLatLng(ne || sw);
			this.south_ = sw.lat();
			this.north_ = ne.lat();
			var west = sw.lng(), east = ne.lng();
			if (east - west >= 360) {
				west = -180;
				east = 180;
			}
			this.west_ = west;
			this.east_ = east;
		}
	}

	function lngSpan(west, east) {
		if (west === 180 && east === -180) return 0;      // empty
		var span = east - west;
		return span >= 0 ? span : span + 360;
	}

	extend(LatLngBounds.prototype, {
		isEmpty: function () { return this.south_ > this.north_; },
		getSouthWest: function () { return new LatLng(this.south_, this.west_, true); },
		getNorthEast: function () { return new LatLng(this.north_, this.east_, true); },
		getCenter: function () {
			var lat = (this.south_ + this.north_) / 2;
			var lng = this.west_ + lngSpan(this.west_, this.east_) / 2;
			return new LatLng(lat, lng);
		},
		crossesAntimeridian_: function () { return this.west_ > this.east_; },
		containsLng_: function (lng) {
			if (this.west_ === -180 && this.east_ === 180) return true;
			if (this.crossesAntimeridian_()) return lng >= this.west_ || lng <= this.east_;
			return lng >= this.west_ && lng <= this.east_;
		},
		contains: function (latLng) {
			latLng = toLatLng(latLng);
			if (!latLng || this.isEmpty()) return false;
			var lat = latLng.lat();
			return lat >= this.south_ && lat <= this.north_ && this.containsLng_(latLng.lng());
		},
		extend: function (latLng) {
			latLng = toLatLng(latLng);
			var lat = latLng.lat(), lng = latLng.lng();
			if (this.isEmpty()) {
				this.south_ = this.north_ = lat;
				this.west_ = this.east_ = lng;
				return this;
			}
			if (lat < this.south_) this.south_ = lat;
			if (lat > this.north_) this.north_ = lat;
			if (!this.containsLng_(lng)) {
				var growEast = (lng - this.east_ + 360) % 360;
				var growWest = (this.west_ - lng + 360) % 360;
				if (growWest < growEast) this.west_ = lng;
				else this.east_ = lng;
			}
			return this;
		},
		union: function (other) {
			if (!other || other.isEmpty()) return this;
			this.extend(other.getSouthWest());
			this.extend(other.getNorthEast());
			return this;
		},
		intersects: function (other) {
			if (!other || this.isEmpty() || other.isEmpty()) return false;
			if (other.north_ < this.south_ || other.south_ > this.north_) return false;
			return this.containsLng_(other.west_) || this.containsLng_(other.east_) ||
				other.containsLng_(this.west_) || other.containsLng_(this.east_);
		},
		equals: function (other) {
			return !!other && this.getSouthWest().equals(other.getSouthWest()) && this.getNorthEast().equals(other.getNorthEast());
		},
		toSpan: function () {
			return new LatLng(this.isEmpty() ? 0 : this.north_ - this.south_, lngSpan(this.west_, this.east_), true);
		},
		toString: function () { return "(" + this.getSouthWest() + ", " + this.getNorthEast() + ")"; },
		toUrlValue: function (precision) {
			return this.getSouthWest().toUrlValue(precision) + "," + this.getNorthEast().toUrlValue(precision);
		},
		toJSON: function () { return { south: this.south_, west: this.west_, north: this.north_, east: this.east_ }; }
	});

	function Point(x, y) {
		this.x = x;
		this.y = y;
	}
	extend(Point.prototype, {
		equals: function (other) { return !!other && other.x === this.x && other.y === this.y; },
		toString: function () { return "(" + this.x + ", " + this.y + ")"; }
	});

	function Size(width, height, widthUnit, heightUnit) {
		this.width = width;
		this.height = height;
		if (widthUnit) this.widthUnit = widthUnit;
		if (heightUnit) this.heightUnit = heightUnit;
	}
	extend(Size.prototype, {
		equals: function (other) { return !!other && other.width === this.width && other.height === this.height; },
		toString: function () { return "(" + this.width + ", " + this.height + ")"; }
	});

	// Legacy icon type (deprecated in Google's API, used throughout Lightroom's page)
	function MarkerImage(url, size, origin, anchor, scaledSize) {
		this.url = url;
		this.size = size || null;
		this.origin = origin || null;
		this.anchor = anchor || null;
		this.scaledSize = scaledSize || null;
	}

	// =========================================================================================
	// Step 2: events and MVCObject
	// =========================================================================================

	function listenerStore(instance) {
		return internal(instance, "__e3_", function () { return {}; });
	}

	function MapsEventListener(instance, name, handler, domRemove) {
		this.instance_ = instance;
		this.name_ = name;
		this.handler_ = handler;
		this.domRemove_ = domRemove || null;
		this.removed_ = false;
	}
	MapsEventListener.prototype.remove = function () {
		if (this.removed_) return;
		this.removed_ = true;
		var list = listenerStore(this.instance_)[this.name_];
		if (list) {
			for (var i = 0; i < list.length; i++) {
				if (list[i] === this) {
					list.splice(i, 1);
					break;
				}
			}
		}
		if (this.domRemove_) this.domRemove_();
	};

	var event = {
		addListener: function (instance, name, handler) {
			var store = listenerStore(instance);
			var listener = new MapsEventListener(instance, name, handler);
			(store[name] || (store[name] = [])).push(listener);
			return listener;
		},
		addListenerOnce: function (instance, name, handler) {
			var listener = event.addListener(instance, name, function () {
				listener.remove();
				return handler.apply(this, arguments);
			});
			return listener;
		},
		addDomListener: function (element, name, handler, capture) {
			var suppressAfterDrag = name === "click" || name === "dblclick";
			var wrapped = function (e) {
				// releasing the mouse on an overlay after dragging the map is not a click
				if (suppressAfterDrag && recentlyDragged()) return;
				return handler.call(element, e || window.event);
			};
			element.addEventListener(name, wrapped, !!capture);
			var store = listenerStore(element);
			var listener = new MapsEventListener(element, name, handler, function () {
				element.removeEventListener(name, wrapped, !!capture);
			});
			(store[name] || (store[name] = [])).push(listener);
			return listener;
		},
		addDomListenerOnce: function (element, name, handler, capture) {
			var listener = event.addDomListener(element, name, function () {
				listener.remove();
				return handler.apply(this, arguments);
			}, capture);
			return listener;
		},
		removeListener: function (listener) {
			if (listener && typeof listener.remove === "function") listener.remove();
		},
		clearListeners: function (instance, name) {
			var list = listenerStore(instance)[name];
			if (!list) return;
			list = list.slice();
			for (var i = 0; i < list.length; i++) list[i].remove();
		},
		clearInstanceListeners: function (instance) {
			var store = listenerStore(instance);
			for (var name in store) {
				if (Object.prototype.hasOwnProperty.call(store, name)) event.clearListeners(instance, name);
			}
		},
		trigger: function (instance, name) {
			if (!instance) return;
			var store = instance.__e3_;
			var list = store && store[name];
			if (!list || !list.length) return;
			var args = Array.prototype.slice.call(arguments, 2);
			list = list.slice();
			for (var i = 0; i < list.length; i++) {
				if (!list[i].removed_) list[i].handler_.apply(instance, args);
			}
		},
		bind: function (instance, name, handlerObject, handlerMethod) {
			return event.addListener(instance, name, function () {
				return handlerObject[handlerMethod].apply(handlerObject, arguments);
			});
		},
		hasListeners_: function (instance, name) {
			var store = instance.__e3_;
			return !!(store && store[name] && store[name].length);
		}
	};

	/*
	 * Trigger for events that originate inside the shim or Leaflet (map moves, animation frames,
	 * timers). Each listener runs in its own try/catch and errors are rethrown asynchronously:
	 * they still reach window.onerror (and so Lightroom's onError), but an exception in page
	 * code cannot leave Leaflet half-way through an animation. Without this, a throwing
	 * bounds_changed listener stops Leaflet's pan animation from ever completing and the
	 * listener is called again on every animation frame.
	 */
	function triggerSafely(instance, name) {
		var store = instance && instance.__e3_;
		var list = store && store[name];
		if (!list || !list.length) return;
		var args = Array.prototype.slice.call(arguments, 2);
		list = list.slice();
		for (var i = 0; i < list.length; i++) {
			if (list[i].removed_) continue;
			try {
				list[i].handler_.apply(instance, args);
			} catch (e) {
				rethrowAsync(e);
			}
		}
	}

	function rethrowAsync(e) {
		window.setTimeout(function () { throw e; }, 0);
	}

	function changedEventName(key) {
		return key.toLowerCase() + "_changed";
	}

	/*
	 * MVCObject. Values are stored as plain properties (this[key]), like in the
	 * Google API of Lightroom's era. Adobe's code relies on that, e.g. map.mapTypes[id].
	 */
	function MVCObject() {}
	extend(MVCObject.prototype, {
		get: function (key) {
			var binding = this.__gm_bindings && this.__gm_bindings[key];
			if (binding) return binding.target.get(binding.targetKey);
			return this[key];
		},
		set: function (key, value) {
			var binding = this.__gm_bindings && this.__gm_bindings[key];
			if (binding) {
				binding.target.set(binding.targetKey, value);
				return;
			}
			this[key] = value;
			this.notify(key);
		},
		notify: function (key) {
			var handler = this[key + "_changed"];
			if (typeof handler === "function") handler.call(this);
			else this.changed(key);
			event.trigger(this, changedEventName(key));
		},
		changed: function () {},
		setValues: function (values) {
			if (!values) return;
			for (var key in values) {
				if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
				var setter = this["set" + capitalize(key)];
				if (typeof setter === "function") setter.call(this, values[key]);
				else this.set(key, values[key]);
			}
		},
		bindTo: function (key, target, targetKey, noNotify) {
			targetKey = targetKey || key;
			this.unbind(key);
			var self = this;
			var bindings = internal(this, "__gm_bindings", function () { return {}; });
			bindings[key] = {
				target: target,
				targetKey: targetKey,
				listener: event.addListener(target, changedEventName(targetKey), function () { self.notify(key); })
			};
			if (!noNotify) this.notify(key);
		},
		unbind: function (key) {
			var binding = this.__gm_bindings && this.__gm_bindings[key];
			if (!binding) return;
			binding.listener.remove();
			delete this.__gm_bindings[key];
			this[key] = binding.target.get(binding.targetKey);
		},
		unbindAll: function () {
			if (!this.__gm_bindings) return;
			for (var key in this.__gm_bindings) {
				if (Object.prototype.hasOwnProperty.call(this.__gm_bindings, key)) this.unbind(key);
			}
		},
		addListener: function (name, handler) {
			return event.addListener(this, name, handler);
		}
	});

	function MVCArray(array) {
		MVCObject.call(this);
		hidden(this, "array_", array ? array.slice() : []);
		this.set("length", this.array_.length);
	}
	inherits(MVCArray, MVCObject);
	extend(MVCArray.prototype, {
		getArray: function () { return this.array_; },
		getAt: function (i) { return this.array_[i]; },
		getLength: function () { return this.array_.length; },
		forEach: function (callback) {
			for (var i = 0; i < this.array_.length; i++) callback(this.array_[i], i);
		},
		insertAt: function (i, elem) {
			this.array_.splice(i, 0, elem);
			this.set("length", this.array_.length);
			event.trigger(this, "insert_at", i);
		},
		removeAt: function (i) {
			var elem = this.array_.splice(i, 1)[0];
			this.set("length", this.array_.length);
			event.trigger(this, "remove_at", i, elem);
			return elem;
		},
		setAt: function (i, elem) {
			if (i >= this.array_.length) {
				this.insertAt(i, elem);
				return;
			}
			var previous = this.array_[i];
			this.array_[i] = elem;
			event.trigger(this, "set_at", i, previous);
		},
		push: function (elem) {
			this.insertAt(this.array_.length, elem);
			return this.array_.length;
		},
		pop: function () { return this.removeAt(this.array_.length - 1); },
		clear: function () {
			while (this.array_.length) this.pop();
		}
	});

	// =========================================================================================
	// Step 3: Map on Leaflet
	// =========================================================================================

	var MapTypeId = { ROADMAP: "roadmap", SATELLITE: "satellite", HYBRID: "hybrid", TERRAIN: "terrain" };

	var ControlPosition = {
		TOP_LEFT: 1, TOP_CENTER: 2, TOP: 2, TOP_RIGHT: 3, LEFT_CENTER: 4, LEFT_TOP: 5, LEFT: 5, LEFT_BOTTOM: 6,
		RIGHT_TOP: 7, RIGHT: 7, RIGHT_CENTER: 8, RIGHT_BOTTOM: 9, BOTTOM_LEFT: 10, BOTTOM_CENTER: 11, BOTTOM: 11,
		BOTTOM_RIGHT: 12, CENTER: 13
	};

	// Web Mercator world coordinates, 256 x 256 at zoom 0 (like Google's map projection)
	var mercator = {
		fromLatLngToPoint: function (latLng, point) {
			var siny = clamp(Math.sin(latLng.lat() * Math.PI / 180), -0.9999, 0.9999);
			point = point || new Point(0, 0);
			point.x = 128 + latLng.lng() * (256 / 360);
			point.y = 128 + 0.5 * Math.log((1 + siny) / (1 - siny)) * -(256 / (2 * Math.PI));
			return point;
		},
		fromPointToLatLng: function (point, noWrap) {
			var lng = (point.x - 128) / (256 / 360);
			var latRadians = (point.y - 128) / -(256 / (2 * Math.PI));
			var lat = (2 * Math.atan(Math.exp(latRadians)) - Math.PI / 2) * 180 / Math.PI;
			return new LatLng(lat, lng, noWrap);
		}
	};

	/*
	 * A map type. "tiles_" names the entry in config.mapTypes that provides the tiles.
	 * Lightroom reads mapType.maxZoom to limit its zoom slider.
	 */
	function ShimMapType(tilesId, options) {
		var tiles = config.mapTypes[tilesId] || config.mapTypes.roadmap;
		this.name = (options && options.name) || tiles.name;
		this.alt = (options && options.alt) || this.name;
		this.maxZoom = (options && options.maxZoom) || tiles.maxZoom || 19;
		this.minZoom = (options && options.minZoom) || 0;
		this.tileSize = new Size(256, 256);
		this.projection = mercator;
		hidden(this, "tiles_", config.mapTypes[tilesId] ? tilesId : "roadmap");
	}

	// StyledMapType: Google's styles can't be applied to raster tiles. The tiles are
	// chosen by the id the type is registered under (lrLight, lrDark), see MapTypeRegistry.set.
	function StyledMapType(styles, options) {
		MVCObject.call(this);
		this.name = (options && options.name) || "Styled";
		this.alt = (options && options.alt) || this.name;
		this.maxZoom = (options && options.maxZoom) || 19;
		this.minZoom = (options && options.minZoom) || 0;
		this.tileSize = new Size(256, 256);
		this.projection = mercator;
		hidden(this, "styles_", styles || []);
		hidden(this, "explicitMaxZoom_", !!(options && options.maxZoom));
	}
	inherits(StyledMapType, MVCObject);

	function MapTypeRegistry() {
		MVCObject.call(this);
	}
	inherits(MapTypeRegistry, MVCObject);
	MapTypeRegistry.prototype.set = function (id, mapType) {
		if (mapType instanceof StyledMapType && config.mapTypes[id]) {
			hidden(mapType, "tiles_", id);
			if (config.mapTypes[id].maxZoom && !mapType.explicitMaxZoom_) mapType.maxZoom = config.mapTypes[id].maxZoom;
		}
		MVCObject.prototype.set.call(this, id, mapType);
	};

	function StreetViewPanorama() {
		MVCObject.call(this);
		this.set("visible", false);
	}
	inherits(StreetViewPanorama, MVCObject);
	extend(StreetViewPanorama.prototype, {
		getVisible: function () { return !!this.get("visible"); },
		setVisible: function (visible) {
			if (visible) warn("Street View is not available");
			this.set("visible", false);
		},
		getPosition: function () { return this.get("position"); },
		setPosition: function (position) { this.set("position", toLatLng(position)); },
		getPov: function () { return this.get("pov") || { heading: 0, pitch: 0 }; },
		setPov: function (pov) { this.set("pov", pov); }
	});

	var styleInjected = false;
	function injectStyle() {
		if (styleInjected || !config.css) return;
		styleInjected = true;
		var style = document.createElement("style");
		style.type = "text/css";
		style.appendChild(document.createTextNode(config.css));
		(document.head || document.getElementsByTagName("head")[0]).appendChild(style);
	}

	function toL(latLng) {
		return window.L.latLng(latLng.lat(), latLng.lng());
	}

	function fromL(ll) {
		return new LatLng(ll.lat, ll.lng);
	}

	function boundsFromL(lb) {
		var sw = lb.getSouthWest(), ne = lb.getNorthEast();
		var west = sw.lng, east = ne.lng;
		if (east - west >= 360) {
			west = -180;
			east = 180;
		} else {
			west = wrapLng(west);
			east = wrapLng(east);
		}
		return new LatLngBounds(new LatLng(Math.max(sw.lat, -90), west, true), new LatLng(Math.min(ne.lat, 90), east, true));
	}

	function boundsToL(bounds) {
		var sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
		var west = sw.lng(), east = ne.lng();
		if (west > east) east += 360;     // crosses the antimeridian
		return window.L.latLngBounds([ sw.lat(), west ], [ ne.lat(), east ]);
	}

	// Google MouseEvent from a Leaflet mouse event
	function mouseEventFromL(e) {
		var original = e.originalEvent;
		return {
			latLng: e.latlng ? fromL(e.latlng) : null,
			pixel: e.containerPoint ? new Point(e.containerPoint.x, e.containerPoint.y) : null,
			domEvent: original,
			stop: function () {
				if (original) {
					if (original.stopPropagation) original.stopPropagation();
					if (original.preventDefault) original.preventDefault();
				}
			}
		};
	}

	var MAP_MOUSE_EVENTS = {
		click: "click", dblclick: "dblclick", contextmenu: "rightclick", mousedown: "mousedown",
		mouseup: "mouseup", mousemove: "mousemove", mouseout: "mouseout", mouseover: "mouseover"
	};

	function Map(mapDiv, options) {
		if (!window.L) throw new Error("mapfix-shim: Leaflet is not loaded (load the shim with ?callback=...)");
		MVCObject.call(this);
		injectStyle();
		options = options || {};

		var self = this;
		var L = window.L;

		// Leaflet renders into an inner div that forms its own stacking context, so elements that
		// others append to getDiv() (KeyDragZoom's veil) are drawn above the map.
		var computed = window.getComputedStyle ? window.getComputedStyle(mapDiv) : null;
		if (!computed || computed.position === "static") mapDiv.style.position = "relative";
		mapDiv.style.overflow = "hidden";
		if (options.backgroundColor) mapDiv.style.backgroundColor = options.backgroundColor;
		var inner = document.createElement("div");
		inner.className = "lrshim-inner";
		inner.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;";
		if (options.backgroundColor) inner.style.backgroundColor = options.backgroundColor;
		mapDiv.appendChild(inner);

		var lat = config.maxLatitude;
		var lmap = L.map(inner, {
			zoomControl: false,
			attributionControl: true,
			minZoom: typeof options.minZoom === "number" ? options.minZoom : 0,
			maxZoom: typeof options.maxZoom === "number" ? options.maxZoom : 19,
			scrollWheelZoom: options.scrollwheel !== false,
			doubleClickZoom: !options.disableDoubleClickZoom,
			dragging: options.draggable !== false,
			keyboard: options.keyboardShortcuts !== false,
			boxZoom: false,
			worldCopyJump: true,
			maxBounds: L.latLngBounds([ -lat, -720 ], [ lat, 720 ]),
			maxBoundsViscosity: 1.0,
			fadeAnimation: true,
			zoomAnimation: true
		});
		var compact = (mapDiv.offsetWidth || 1000) < config.compactWidth;
		if (compact) inner.className += " lrshim-compact";
		lmap.attributionControl.setPrefix(compact ? false : (config.attributionPrefix || false));
		if (options.backgroundColor) inner.style.background = options.backgroundColor;

		hidden(this, "div_", mapDiv);
		hidden(this, "inner_", inner);
		hidden(this, "lmap_", lmap);
		hidden(this, "layers_", null);
		hidden(this, "compact_", compact);
		hidden(this, "tilt_", typeof options.tilt === "number" ? options.tilt : 0);
		hidden(this, "heading_", 0);
		hidden(this, "lastZoom_", null);
		hidden(this, "pendingZoom_", null);
		hidden(this, "streetView_", new StreetViewPanorama());

		this.mapTypes = new MapTypeRegistry();
		this.mapTypes.set(MapTypeId.ROADMAP, new ShimMapType("roadmap"));
		this.mapTypes.set(MapTypeId.SATELLITE, new ShimMapType("satellite"));
		this.mapTypes.set(MapTypeId.HYBRID, new ShimMapType("hybrid"));
		this.mapTypes.set(MapTypeId.TERRAIN, new ShimMapType("terrain"));
		// re-apply the current map type if its registry entry changes (e.g. lrLight registered late)
		event.addListener(this.mapTypes, "lrlight_changed", function () { self.refreshMapType_("lrLight"); });
		event.addListener(this.mapTypes, "lrdark_changed", function () { self.refreshMapType_("lrDark"); });

		initOverlaySupport(this);

		this.controls = [];
		for (var p = 0; p <= 13; p++) this.controls.push(new MVCArray());

		if (options.scaleControl) L.control.scale({ position: "bottomleft" }).addTo(lmap);

		// Leaflet events -> Google events
		for (var leafletName in MAP_MOUSE_EVENTS) {
			if (Object.prototype.hasOwnProperty.call(MAP_MOUSE_EVENTS, leafletName)) {
				(function (lName, gName) {
					lmap.on(lName, function (e) { triggerSafely(self, gName, mouseEventFromL(e)); });
				})(leafletName, MAP_MOUSE_EVENTS[leafletName]);
			}
		}
		lmap.on("dragstart", function () { triggerSafely(self, "dragstart"); });
		lmap.on("drag", function () { triggerSafely(self, "drag"); });
		lmap.on("dragend", function () { triggerSafely(self, "dragend"); });
		lmap.on("move", function () {
			triggerSafely(self, "center_changed");
			triggerSafely(self, "bounds_changed");
		});
		lmap.on("zoomend", function () { self.checkZoomChanged_(); });
		lmap.on("moveend", function () {
			self.checkZoomChanged_();
			triggerSafely(self, "idle");
		});
		lmap.on("resize", function () { triggerSafely(self, "bounds_changed"); });
		// Google API v3 convention: trigger(map, "resize") after the container changed size
		event.addListener(this, "resize", function () { lmap.invalidateSize(false); });

		var center = toLatLng(options.center) || new LatLng(0, 0);
		var zoom = typeof options.zoom === "number" ? options.zoom : 2;
		lmap.setView(toL(center), zoom, { animate: false });
		this.lastZoom_ = lmap.getZoom();

		this.setMapTypeId(options.mapTypeId || MapTypeId.ROADMAP);

		// projection_changed fires asynchronously in Google's API once the map is ready
		window.setTimeout(function () {
			triggerSafely(self, "projection_changed");
			triggerSafely(self, "tilesloaded");
		}, 0);
	}
	inherits(Map, MVCObject);

	extend(Map.prototype, {
		getDiv: function () { return this.div_; },

		// --- center and zoom ---------------------------------------------------------------
		getCenter: function () {
			var lmap = this.lmap_;
			var c = lmap._animatingZoom && lmap._animateToCenter ? lmap._animateToCenter : lmap.getCenter();
			return fromL(c);
		},
		setCenter: function (latLng) {
			latLng = toLatLng(latLng);
			if (!latLng) return;
			this.lmap_.setView(toL(latLng), this.getZoom(), { animate: false });
		},
		panTo: function (latLng) {
			latLng = toLatLng(latLng);
			if (latLng) this.lmap_.panTo(toL(latLng), { animate: true });
		},
		panBy: function (x, y) {
			this.lmap_.panBy([ x, y ], { animate: true });
		},
		panToBounds: function (bounds) {
			if (!bounds || bounds.isEmpty()) return;
			var view = this.getBounds();
			if (view && view.contains(bounds.getSouthWest()) && view.contains(bounds.getNorthEast())) return;
			this.panTo(bounds.getCenter());
		},
		fitBounds: function (bounds, padding) {
			if (!bounds || bounds.isEmpty()) return;
			var options = { animate: false };
			if (typeof padding === "number") options.padding = [ padding, padding ];
			else if (padding && typeof padding === "object") {
				options.paddingTopLeft = [ padding.left || 0, padding.top || 0 ];
				options.paddingBottomRight = [ padding.right || 0, padding.bottom || 0 ];
			}
			this.lmap_.fitBounds(boundsToL(bounds), options);
		},
		getBounds: function () {
			return boundsFromL(this.lmap_.getBounds());
		},
		// Google returns the new zoom right after setZoom(); Leaflet only updates its zoom when
		// the zoom animation (started on the next animation frame) has finished.
		getZoom: function () {
			if (this.pendingZoom_ !== null) return this.pendingZoom_;
			var lmap = this.lmap_;
			return lmap._animatingZoom && typeof lmap._animateToZoom === "number" ? lmap._animateToZoom : lmap.getZoom();
		},
		setZoom: function (zoom) {
			zoom = Math.round(toNumber(zoom));
			if (isNaN(zoom)) return;
			var lmap = this.lmap_;
			zoom = clamp(zoom, lmap.getMinZoom(), lmap.getMaxZoom());
			if (zoom === lmap.getZoom() && this.pendingZoom_ === null) return;
			this.pendingZoom_ = zoom;
			lmap.setZoom(zoom, { animate: true });
		},
		checkZoomChanged_: function () {
			this.pendingZoom_ = null;
			var zoom = this.lmap_.getZoom();
			if (zoom !== this.lastZoom_) {
				this.lastZoom_ = zoom;
				triggerSafely(this, "zoom_changed");
			}
		},

		// --- map types ---------------------------------------------------------------------
		getMapTypeId: function () { return this.get("mapTypeId"); },
		setMapTypeId: function (id) { this.set("mapTypeId", id); },
		mapTypeId_changed: function () { this.applyMapType_(); },
		refreshMapType_: function (id) {
			if (this.get("mapTypeId") === id) this.applyMapType_();
		},
		applyMapType_: function () {
			var L = window.L, lmap = this.lmap_;
			var id = this.get("mapTypeId");
			var mapType = this.mapTypes.get(id);
			var tilesId = (mapType && mapType.tiles_) || (config.mapTypes[id] ? id : null);
			if (!tilesId) {
				// not registered yet (e.g. lrLight before mapTypes.set); applied when it is
				return;
			}
			var tiles = config.mapTypes[tilesId];
			var group = L.layerGroup();
			for (var i = 0; i < tiles.layers.length; i++) {
				var t = tiles.layers[i];
				var options = {
					maxZoom: (mapType && mapType.maxZoom) || tiles.maxZoom || 19,
					maxNativeZoom: t.maxNativeZoom || tiles.maxZoom || 19,
					attribution: (this.compact_ && t.shortAttribution) || t.attribution || "",
					subdomains: t.subdomains || "abc",
					crossOrigin: false
				};
				if (t.className) options.className = t.className;
				group.addLayer(L.tileLayer(t.url, options));
			}
			if (this.layers_) lmap.removeLayer(this.layers_);
			this.layers_ = group;
			group.addTo(lmap);
			var maxZoom = (mapType && mapType.maxZoom) || tiles.maxZoom || 19;
			lmap.setMaxZoom(maxZoom);
			if (lmap.getZoom() > maxZoom) lmap.setZoom(maxZoom, { animate: false });
		},

		// --- other state -------------------------------------------------------------------
		getTilt: function () { return this.tilt_; },
		setTilt: function (tilt) { this.tilt_ = tilt; },      // no 45 degree imagery
		getHeading: function () { return this.heading_; },
		setHeading: function (heading) { this.heading_ = heading; },
		getStreetView: function () { return this.streetView_; },
		setStreetView: function () {},
		getProjection: function () { return mercator; },
		setOptions: function (options) {
			if (!options) return;
			var lmap = this.lmap_;
			var handlers = {
				center: function (v) { this.setCenter(v); },
				zoom: function (v) { this.setZoom(v); },
				mapTypeId: function (v) { this.setMapTypeId(v); },
				minZoom: function (v) { if (typeof v === "number") lmap.setMinZoom(v); },
				maxZoom: function (v) { if (typeof v === "number") lmap.setMaxZoom(v); },
				draggable: function (v) { if (v === false) lmap.dragging.disable(); else lmap.dragging.enable(); },
				scrollwheel: function (v) { if (v === false) lmap.scrollWheelZoom.disable(); else lmap.scrollWheelZoom.enable(); },
				disableDoubleClickZoom: function (v) { if (v) lmap.doubleClickZoom.disable(); else lmap.doubleClickZoom.enable(); },
				keyboardShortcuts: function (v) { if (v === false) lmap.keyboard.disable(); else lmap.keyboard.enable(); },
				backgroundColor: function (v) { this.div_.style.backgroundColor = v; this.inner_.style.background = v; },
				tilt: function (v) { this.setTilt(v); },
				heading: function (v) { this.setHeading(v); }
			};
			for (var key in options) {
				if (!Object.prototype.hasOwnProperty.call(options, key)) continue;
				if (handlers[key]) handlers[key].call(this, options[key]);
				// controls and other options are ignored: Lightroom draws its own controls
			}
		},

		getLeafletMap_: function () { return this.lmap_; }
	});

	// =========================================================================================
	// Step 4a: overlay support on the map (panes, projection, redraw), shared by all overlays
	// =========================================================================================

	// Google's overlay panes, bottom to top, as Leaflet panes. Custom panes hide during
	// Leaflet's zoom animation (leaflet-zoom-hide) because their contents are only
	// repositioned by OverlayView.draw() once the zoom has finished.
	var PANES = [
		[ "mapPane", 250 ],
		[ "overlayLayer", 420 ],
		[ "overlayShadow", 590 ],
		[ "overlayImage", 610 ],
		[ "floatShadow", 640 ],
		[ "overlayMouseTarget", 650 ],
		[ "floatPane", 710 ]
	];

	// Time of the last map drag. A mouse button released on a cluster icon after dragging
	// the map would otherwise count as a click on that icon (the icon moves with the map).
	var lastMapDragEnd = 0;

	function initOverlaySupport(map) {
		var L = window.L, lmap = map.lmap_;
		var panes = {};
		for (var i = 0; i < PANES.length; i++) {
			var pane = lmap.createPane("gm-" + PANES[i][0]);
			pane.style.zIndex = PANES[i][1];
			pane.className += " leaflet-zoom-hide lrshim-pane-" + PANES[i][0];
			// DOM clicks on overlays must not also become map clicks (Google behaves like this).
			// mousedown is not stopped, so the map can still be dragged by grabbing an overlay.
			L.DomEvent.on(pane, "click dblclick contextmenu", L.DomEvent.stopPropagation);
			panes[PANES[i][0]] = pane;
		}
		hidden(map, "panes_", panes);
		hidden(map, "overlays_", []);          // OverlayViews that received onAdd
		hidden(map, "pendingOverlays_", []);   // OverlayViews waiting for onAdd
		hidden(map, "vectors_", []);           // Circle/Polyline/Rectangle on the map, for zIndex order
		hidden(map, "canvasProjection_", new MapCanvasProjection(map));

		function redrawAll() {
			var list = map.overlays_.slice();
			for (var j = 0; j < list.length; j++) {
				if (list[j].added_ && typeof list[j].draw === "function") {
					try {
						list[j].draw();
					} catch (e) {
						rethrowAsync(e);
					}
				}
			}
			var vectors = map.vectors_.slice();
			for (var k = 0; k < vectors.length; k++) vectors[k].redraw_();
		}
		lmap.on("zoomend viewreset resize", redrawAll);
		lmap.on("dragend", function () { lastMapDragEnd = new Date().getTime(); });
	}

	function recentlyDragged() {
		return new Date().getTime() - lastMapDragEnd < 300;
	}

	// The projection that OverlayView.getProjection() returns.
	// "Div pixels" are Leaflet layer points: relative to the overlay panes, which move with the map.
	function MapCanvasProjection(map) {
		hidden(this, "map_", map);
	}
	extend(MapCanvasProjection.prototype, {
		// Leaflet's latLngToLayerPoint rounds to whole pixels; Google's projection doesn't.
		fromLatLngToDivPixel: function (latLng) {
			if (!latLng) return null;
			var lmap = this.map_.lmap_;
			var p = lmap.project(toL(toLatLng(latLng))).subtract(lmap.getPixelOrigin());
			return new Point(p.x, p.y);
		},
		fromDivPixelToLatLng: function (point, noWrap) {
			if (!point) return null;
			var ll = this.map_.lmap_.layerPointToLatLng(window.L.point(point.x, point.y));
			return new LatLng(ll.lat, ll.lng, noWrap);
		},
		fromLatLngToContainerPixel: function (latLng) {
			if (!latLng) return null;
			var lmap = this.map_.lmap_;
			var p = lmap.layerPointToContainerPoint(lmap.project(toL(toLatLng(latLng))).subtract(lmap.getPixelOrigin()));
			return new Point(p.x, p.y);
		},
		fromContainerPixelToLatLng: function (point, noWrap) {
			if (!point) return null;
			var ll = this.map_.lmap_.containerPointToLatLng(window.L.point(point.x, point.y));
			return new LatLng(ll.lat, ll.lng, noWrap);
		},
		getWorldWidth: function () {
			return 256 * Math.pow(2, this.map_.lmap_.getZoom());
		},
		getVisibleRegion: function () {
			var b = this.map_.getBounds();
			var sw = b.getSouthWest(), ne = b.getNorthEast();
			return {
				latLngBounds: b,
				farLeft: new LatLng(ne.lat(), sw.lng(), true),
				farRight: ne,
				nearLeft: sw,
				nearRight: new LatLng(sw.lat(), ne.lng(), true)
			};
		}
	});

	function flushPendingOverlays(map) {
		var pending = map.pendingOverlays_;
		map.pendingOverlays_ = [];
		for (var i = 0; i < pending.length; i++) {
			var overlay = pending[i];
			if (overlay.get("map") !== map || overlay.added_) continue;
			overlay.added_ = true;
			map.overlays_.push(overlay);
			try {
				if (typeof overlay.onAdd === "function") overlay.onAdd();
				if (typeof overlay.draw === "function") overlay.draw();
			} catch (e) {
				rethrowAsync(e);
			}
		}
	}

	function removeFromArray(array, item) {
		for (var i = 0; i < array.length; i++) {
			if (array[i] === item) {
				array.splice(i, 1);
				return true;
			}
		}
		return false;
	}

	// =========================================================================================
	// Step 4b: OverlayView
	// =========================================================================================

	/*
	 * OverlayView. Prototype methods are enumerable and onAdd/draw/onRemove are absent on
	 * purpose (see the rules at the top). Lightroom's MarkerClusterer and ClusterIcon copy
	 * these methods onto their own prototypes and never run this constructor, so all state
	 * is created lazily.
	 */
	function OverlayView() {}
	inherits(OverlayView, MVCObject);
	extend(OverlayView.prototype, {
		setMap: function (map) {
			var current = this.get("map") || null;
			map = map || null;
			if (current === map) return;
			if (current && current.pendingOverlays_) {
				if (!this.added_) removeFromArray(current.pendingOverlays_, this);
				else {
					this.added_ = false;
					removeFromArray(current.overlays_, this);
					try {
						if (typeof this.onRemove === "function") this.onRemove();
					} catch (e) {
						rethrowAsync(e);
					}
				}
			}
			if (!Object.prototype.hasOwnProperty.call(this, "added_")) hidden(this, "added_", false);
			this.set("map", map);
			if (map && map.pendingOverlays_) {
				// Google calls onAdd asynchronously; many overlays are added in one go.
				map.pendingOverlays_.push(this);
				if (map.pendingOverlays_.length === 1) {
					window.setTimeout(function () { flushPendingOverlays(map); }, 0);
				}
			}
		},
		getMap: function () { return this.get("map") || null; },
		getPanes: function () {
			var map = this.get("map");
			return map ? map.panes_ : null;
		},
		// Available as soon as the overlay has a map (Google: once onAdd is called). Lightroom's
		// MarkerClusterer can ask for it from a bounds_changed listener before its onAdd ran.
		getProjection: function () {
			var map = this.get("map");
			return map ? map.canvasProjection_ : null;
		}
	});

	// =========================================================================================
	// Step 4c: Marker (Leaflet L.marker)
	// =========================================================================================

	var Animation = { BOUNCE: 1, DROP: 2 };

	config.css += "@keyframes lrshim-bounce { 0%, 100% { top: 0; } 50% { top: -14px; } }\n" +
		"@keyframes lrshim-drop { 0% { top: -200px; } 100% { top: 0; } }\n" +
		".lrshim-bounce { animation: lrshim-bounce 0.7s ease-in-out infinite; }\n" +
		".lrshim-drop { animation: lrshim-drop 0.4s ease-in 1; }\n";

	// MarkerImage / Icon / URL string -> Leaflet icon (cached on the icon object)
	function leafletIcon(icon, shadow) {
		var L = window.L;
		if (!icon) return new L.Icon.Default();
		if (typeof icon === "string") icon = { url: icon };
		var cacheKey = shadow ? (typeof shadow === "string" ? shadow : shadow.url) : "";
		var cache = internal(icon, "__lrshimIcons", function () { return {}; });
		if (cache[cacheKey]) return cache[cacheKey];

		var size = icon.scaledSize || icon.size;
		var options = { iconUrl: icon.url, className: "lrshim-marker" };
		if (size) {
			options.iconSize = [ size.width, size.height ];
			// Google's default anchor is the bottom center of the image
			options.iconAnchor = icon.anchor ? [ icon.anchor.x, icon.anchor.y ] : [ size.width / 2, size.height ];
		} else if (icon.anchor) {
			options.iconAnchor = [ icon.anchor.x, icon.anchor.y ];
		}
		if (icon.origin && (icon.origin.x || icon.origin.y)) warn("sprite origins in marker icons are not supported");
		if (shadow) {
			if (typeof shadow === "string") shadow = { url: shadow };
			var shadowSize = shadow.scaledSize || shadow.size;
			options.shadowUrl = shadow.url;
			if (shadowSize) {
				options.shadowSize = [ shadowSize.width, shadowSize.height ];
				options.shadowAnchor = shadow.anchor ? [ shadow.anchor.x, shadow.anchor.y ] : [ shadowSize.width / 2, shadowSize.height ];
			}
		}
		cache[cacheKey] = L.icon(options);
		return cache[cacheKey];
	}

	// same sizing as Leaflet's Icon._setIconStyles
	function setImageStyles(img, url, size, anchor) {
		if (!img) return;
		if (img.getAttribute("src") !== url) img.src = url;
		if (size) {
			img.style.width = size[0] + "px";
			img.style.height = size[1] + "px";
		}
		var a = anchor || (size ? [ size[0] / 2, size[1] / 2 ] : null);
		if (a) {
			img.style.marginLeft = (-a[0]) + "px";
			img.style.marginTop = (-a[1]) + "px";
		}
	}

	var MARKER_EVENTS = {
		click: "click", dblclick: "dblclick", contextmenu: "rightclick", mousedown: "mousedown",
		mouseup: "mouseup", mouseover: "mouseover", mouseout: "mouseout"
	};

	function Marker(options) {
		MVCObject.call(this);
		hidden(this, "lmarker_", null);
		hidden(this, "lmap_", null);
		hidden(this, "dragging_", false);
		hidden(this, "iconPending_", false);
		this.setValues(options || {});
	}
	inherits(Marker, MVCObject);
	extend(Marker.prototype, {
		getMap: function () { return this.get("map") || null; },
		setMap: function (map) { this.set("map", map || null); },
		getPosition: function () { return this.get("position") || null; },
		setPosition: function (p) { this.set("position", toLatLng(p)); },
		getVisible: function () { return this.get("visible") !== false; },
		setVisible: function (v) { this.set("visible", v); },
		getDraggable: function () { return !!this.get("draggable"); },
		setDraggable: function (v) { this.set("draggable", !!v); },
		getClickable: function () { return this.get("clickable") !== false; },
		setClickable: function (v) { this.set("clickable", v); },
		getIcon: function () { return this.get("icon"); },
		setIcon: function (v) { this.set("icon", v); },
		getShadow: function () { return this.get("shadow"); },
		setShadow: function (v) { this.set("shadow", v); },
		getTitle: function () { return this.get("title"); },
		setTitle: function (v) { this.set("title", v); },
		getZIndex: function () { return this.get("zIndex"); },
		setZIndex: function (v) { this.set("zIndex", v); },
		getOpacity: function () { return this.get("opacity"); },
		setOpacity: function (v) { this.set("opacity", v); },
		getAnimation: function () { return this.get("animation") || null; },
		setAnimation: function (v) { this.set("animation", v); },
		setOptions: function (options) { this.setValues(options); },

		// MVCObject calls changed(key) for every property change
		changed: function (key) {
			switch (key) {
				case "map":
				case "visible":
				case "position":
					if (key === "position" && this.dragging_) return;   // Leaflet moves it itself
					this.update_();
					break;
				case "icon":
				case "shadow":
					this.applyIcon_();
					break;
				case "draggable":
					if (this.lmarker_ && this.lmarker_.dragging) {
						if (this.get("draggable")) this.lmarker_.dragging.enable();
						else this.lmarker_.dragging.disable();
					}
					break;
				case "zIndex":
					if (this.lmarker_) this.lmarker_.setZIndexOffset(this.zIndexOffset_());
					break;
				case "opacity":
					if (this.lmarker_) this.lmarker_.setOpacity(typeof this.get("opacity") === "number" ? this.get("opacity") : 1);
					break;
				case "title":
					var el = this.lmarker_ && this.lmarker_.getElement();
					if (el) el.title = this.get("title") || "";
					break;
				case "animation":
					this.applyAnimation_();
					break;
				case "clickable":
					// Leaflet can't switch interactivity of a marker that is on the map
					if (this.lmarker_) {
						this.remove_();
						this.update_();
					}
					break;
			}
		},

		zIndexOffset_: function () {
			// Google's zIndex wins over the default latitude ordering, Leaflet's offset is added to y
			var z = this.get("zIndex");
			return typeof z === "number" ? z * 100000 : 0;
		},

		update_: function () {
			var map = this.get("map");
			var position = this.get("position");
			var show = !!(map && position && this.get("visible") !== false);
			if (!show) {
				this.remove_();
				return;
			}
			if (this.lmarker_ && this.lmap_ !== map.lmap_) this.remove_();
			if (!this.lmarker_) this.create_(map);
			else this.lmarker_.setLatLng(toL(position));
		},

		create_: function (map) {
			var L = window.L, self = this;
			var marker = L.marker(toL(this.get("position")), {
				icon: leafletIcon(this.get("icon"), this.get("shadow")),
				title: this.get("title") || "",
				draggable: !!this.get("draggable"),
				interactive: this.get("clickable") !== false || !!this.get("draggable"),
				keyboard: false,
				riseOnHover: false,
				autoPan: true,
				bubblingMouseEvents: false,
				zIndexOffset: this.zIndexOffset_(),
				opacity: typeof this.get("opacity") === "number" ? this.get("opacity") : 1
			});
			for (var lName in MARKER_EVENTS) {
				if (Object.prototype.hasOwnProperty.call(MARKER_EVENTS, lName)) {
					(function (l, g) {
						marker.on(l, function (e) { triggerSafely(self, g, mouseEventFromL(e)); });
					})(lName, MARKER_EVENTS[lName]);
				}
			}
			marker.on("dragstart", function () {
				self.dragging_ = true;
				triggerSafely(self, "dragstart", self.dragEvent_(marker.getLatLng()));
			});
			marker.on("drag", function (e) {
				var ll = e.latlng || marker.getLatLng();
				self.position = fromL(ll);
				triggerSafely(self, "position_changed");
				triggerSafely(self, "drag", self.dragEvent_(ll));
			});
			marker.on("dragend", function () {
				var ll = marker.getLatLng();
				self.position = fromL(ll);
				self.dragging_ = false;
				triggerSafely(self, "position_changed");
				triggerSafely(self, "dragend", self.dragEvent_(ll));
				if (self.iconPending_) {
					self.iconPending_ = false;
					self.applyIcon_();
				}
			});
			this.lmarker_ = marker;
			this.lmap_ = map.lmap_;
			marker.addTo(map.lmap_);
			this.applyAnimation_();
		},

		/*
		 * Lightroom swaps the icon on every mouseover, mouseout and drag start. Leaflet's setIcon()
		 * replaces the DOM element, which ends a drag in progress and fires extra mouse events,
		 * so image icons are updated in place instead.
		 */
		applyIcon_: function () {
			var m = this.lmarker_;
			if (!m) return;
			var licon = leafletIcon(this.get("icon"), this.get("shadow"));
			if (m.options.icon === licon) return;
			var o = licon.options, old = m.options.icon.options;
			var el = m._icon, shadowEl = m._shadow;
			if (el && el.tagName === "IMG" && !!o.shadowUrl === !!old.shadowUrl && (!o.shadowUrl || shadowEl)) {
				m.options.icon = licon;
				setImageStyles(el, o.iconUrl, o.iconSize, o.iconAnchor);
				if (o.shadowUrl) setImageStyles(shadowEl, o.shadowUrl, o.shadowSize, o.shadowAnchor || o.iconAnchor);
			} else if (this.dragging_) {
				this.iconPending_ = true;   // applied at dragend
			} else {
				m.setIcon(licon);
				this.applyAnimation_();
			}
		},

		dragEvent_: function (ll) {
			return { latLng: fromL(ll), domEvent: null, stop: function () {} };
		},

		remove_: function () {
			if (this.lmarker_) {
				this.lmarker_.off();
				this.lmarker_.remove();
				this.lmarker_ = null;
				this.lmap_ = null;
			}
		},

		applyAnimation_: function () {
			var el = this.lmarker_ && this.lmarker_.getElement();
			if (!el) return;
			var animation = this.get("animation");
			el.className = el.className.replace(/\s*lrshim-(bounce|drop)/g, "");
			if (animation === Animation.BOUNCE) el.className += " lrshim-bounce";
			else if (animation === Animation.DROP) {
				el.className += " lrshim-drop";
				var self = this;
				window.setTimeout(function () {
					if (self.get("animation") === Animation.DROP) self.set("animation", null);
				}, 450);
			}
		}
	});

	// =========================================================================================
	// Step 4d: Circle, Polyline and Rectangle (Leaflet SVG paths)
	// =========================================================================================

	var SymbolPath = { CIRCLE: 0, FORWARD_CLOSED_ARROW: 1, FORWARD_OPEN_ARROW: 2, BACKWARD_CLOSED_ARROW: 3, BACKWARD_OPEN_ARROW: 4 };

	var VECTOR_EVENTS = {
		click: "click", dblclick: "dblclick", contextmenu: "rightclick", mousedown: "mousedown",
		mouseup: "mouseup", mousemove: "mousemove", mouseover: "mouseover", mouseout: "mouseout"
	};

	// Google's defaults, not Leaflet's blue
	function vectorStyle(o, closed) {
		var style = {
			color: o.get("strokeColor") || "#000000",
			opacity: typeof o.get("strokeOpacity") === "number" ? o.get("strokeOpacity") : 1,
			weight: typeof o.get("strokeWeight") === "number" ? o.get("strokeWeight") : 3,
			lineJoin: "round",
			lineCap: "round"
		};
		if (closed) {
			style.fill = true;
			style.fillColor = o.get("fillColor") || "#000000";
			style.fillOpacity = typeof o.get("fillOpacity") === "number" ? o.get("fillOpacity") : 0.3;
		} else {
			style.fill = false;
		}
		return style;
	}

	/*
	 * Shared behavior of Circle, Polyline and Rectangle: the Leaflet layer is (re)built from the
	 * MVC properties whenever the overlay is on a map, visible and has enough data.
	 */
	var vectorMethods = {
		getMap: function () { return this.get("map") || null; },
		setMap: function (map) { this.set("map", map || null); },
		getVisible: function () { return this.get("visible") !== false; },
		setVisible: function (v) { this.set("visible", v); },
		getDraggable: function () { return !!this.get("draggable"); },
		setDraggable: function (v) { this.set("draggable", v); },   // not supported, kept for API
		getEditable: function () { return false; },
		setEditable: function () {},
		setOptions: function (options) { this.setValues(options); },

		changed: function (key) {
			if (key === "map" || key === "visible" || key === "clickable" || key === "icons") {
				this.rebuild_();
			} else if (key === "zIndex") {
				var map = this.get("map");
				if (map && this.layer_) sortVectors(map);
			} else if (/^(stroke|fill)/.test(key)) {
				if (this.layer_) this.layer_.setStyle(vectorStyle(this, this.closed_));
				this.redraw_();
			} else {
				this.geometryChanged_(key);
			}
		},

		rebuild_: function () {
			this.removeLayer_();
			var map = this.get("map");
			if (!map || this.get("visible") === false || !this.hasGeometry_()) return;
			var self = this;
			var style = vectorStyle(this, this.closed_);
			style.interactive = this.get("clickable") !== false;
			style.bubblingMouseEvents = false;
			var layer = this.createLayer_(style);
			for (var lName in VECTOR_EVENTS) {
				if (Object.prototype.hasOwnProperty.call(VECTOR_EVENTS, lName)) {
					(function (l, g) {
						layer.on(l, function (e) { triggerSafely(self, g, mouseEventFromL(e)); });
					})(lName, VECTOR_EVENTS[lName]);
				}
			}
			this.layer_ = layer;
			this.lmap_ = map.lmap_;
			this.vectorMap_ = map;
			layer.addTo(map.lmap_);
			map.vectors_.push(this);
			sortVectors(map);
			this.redraw_();
		},

		removeLayer_: function () {
			if (this.decoration_) {
				this.decoration_.remove();
				this.decoration_ = null;
			}
			if (this.layer_) {
				this.layer_.off();
				this.layer_.remove();
				this.layer_ = null;
			}
			if (this.vectorMap_) removeFromArray(this.vectorMap_.vectors_, this);
			this.vectorMap_ = null;
			this.lmap_ = null;
		},

		// called after zoom changes; only polylines with arrow symbols need it
		redraw_: function () {}
	};

	function sortVectors(map) {
		var list = map.vectors_.slice();
		for (var i = 0; i < list.length; i++) list[i].order_ = i;
		list.sort(function (a, b) {
			var za = typeof a.get("zIndex") === "number" ? a.get("zIndex") : 0;
			var zb = typeof b.get("zIndex") === "number" ? b.get("zIndex") : 0;
			return za - zb || a.order_ - b.order_;
		});
		for (var j = 0; j < list.length; j++) {
			if (list[j].layer_) list[j].layer_.bringToFront();
			if (list[j].decoration_) list[j].decoration_.bringToFront();
		}
	}

	function vectorClass(init, methods) {
		function Vector(options) {
			MVCObject.call(this);
			hidden(this, "layer_", null);
			hidden(this, "decoration_", null);
			hidden(this, "lmap_", null);
			hidden(this, "vectorMap_", null);
			hidden(this, "order_", 0);
			init.call(this);
			this.setValues(options || {});
		}
		inherits(Vector, MVCObject);
		extend(Vector.prototype, vectorMethods);
		extend(Vector.prototype, methods);
		return Vector;
	}

	// --- Circle ---------------------------------------------------------------------------------

	var Circle = vectorClass(function () {
		hidden(this, "closed_", true);
	}, {
		getCenter: function () { return this.get("center") || null; },
		setCenter: function (v) { this.set("center", toLatLng(v)); },
		getRadius: function () { return this.get("radius"); },
		setRadius: function (v) { this.set("radius", toNumber(v)); },
		getBounds: function () {
			var c = this.get("center"), r = this.get("radius");
			if (!c || typeof r !== "number") return null;
			var dLat = r / 111320;
			var dLng = r / (111320 * Math.max(Math.cos(c.lat() * Math.PI / 180), 1e-6));
			return new LatLngBounds(new LatLng(c.lat() - dLat, c.lng() - dLng), new LatLng(c.lat() + dLat, c.lng() + dLng));
		},
		hasGeometry_: function () {
			return !!this.get("center") && typeof this.get("radius") === "number" && !isNaN(this.get("radius"));
		},
		createLayer_: function (style) {
			style.radius = this.get("radius");
			return window.L.circle(toL(this.get("center")), style);
		},
		geometryChanged_: function (key) {
			if (key !== "center" && key !== "radius") return;
			if (!this.layer_) {
				this.rebuild_();
				return;
			}
			if (!this.hasGeometry_()) {
				this.rebuild_();
				return;
			}
			if (key === "center") this.layer_.setLatLng(toL(this.get("center")));
			else this.layer_.setRadius(this.get("radius"));
		}
	});

	// --- Polyline ---------------------------------------------------------------------------------

	function toMVCArrayOfLatLng(path) {
		if (path instanceof MVCArray) return path;
		var list = [];
		if (path) for (var i = 0; i < path.length; i++) list.push(toLatLng(path[i]));
		return new MVCArray(list);
	}

	var Polyline = vectorClass(function () {
		hidden(this, "closed_", false);
		hidden(this, "pathListeners_", []);
	}, {
		getPath: function () {
			if (!this.get("path")) this.set("path", new MVCArray());
			return this.get("path");
		},
		setPath: function (path) { this.set("path", toMVCArrayOfLatLng(path)); },
		hasGeometry_: function () {
			var path = this.get("path");
			return !!path && path.getLength() > 0;
		},
		leafletPath_: function () {
			var out = [], path = this.get("path");
			if (path) {
				var a = path.getArray();
				for (var i = 0; i < a.length; i++) if (a[i]) out.push(toL(a[i]));
			}
			return out;
		},
		createLayer_: function (style) {
			return window.L.polyline(this.leafletPath_(), style);
		},
		geometryChanged_: function (key) {
			if (key !== "path") return;
			var path = this.get("path");
			if (path && !(path instanceof MVCArray)) {
				this.set("path", toMVCArrayOfLatLng(path));   // plain arrays from setValues
				return;
			}
			for (var i = 0; i < this.pathListeners_.length; i++) this.pathListeners_[i].remove();
			this.pathListeners_ = [];
			if (path) {
				var self = this, update = function () { self.pathUpdated_(); };
				this.pathListeners_.push(event.addListener(path, "insert_at", update));
				this.pathListeners_.push(event.addListener(path, "remove_at", update));
				this.pathListeners_.push(event.addListener(path, "set_at", update));
			}
			this.pathUpdated_();
		},
		pathUpdated_: function () {
			if (!this.layer_ || !this.hasGeometry_()) {
				this.rebuild_();
				return;
			}
			this.layer_.setLatLngs(this.leafletPath_());
			this.redraw_();
		},

		// Symbols along the line: only arrow heads at a percentage offset are supported
		// (Lightroom draws one at offset "100%").
		redraw_: function () {
			var icons = this.get("icons");
			var lmap = this.lmap_;
			if (this.decoration_) {
				this.decoration_.remove();
				this.decoration_ = null;
			}
			if (!lmap || !this.layer_ || !icons || !icons.length) return;
			var group = window.L.layerGroup();
			for (var i = 0; i < icons.length; i++) {
				var shape = this.arrowShape_(icons[i]);
				if (shape) group.addLayer(shape);
			}
			this.decoration_ = group;
			group.addTo(lmap);
		},

		arrowShape_: function (iconSequence) {
			var L = window.L, lmap = this.lmap_;
			var symbol = iconSequence && iconSequence.icon;
			if (!symbol) return null;
			var kind = symbol.path;
			if (kind !== SymbolPath.FORWARD_CLOSED_ARROW && kind !== SymbolPath.FORWARD_OPEN_ARROW &&
					kind !== SymbolPath.BACKWARD_CLOSED_ARROW && kind !== SymbolPath.BACKWARD_OPEN_ARROW) {
				return null;
			}
			var pts = this.leafletPath_();
			if (pts.length < 2) return null;
			var px = [];
			for (var i = 0; i < pts.length; i++) px.push(lmap.latLngToLayerPoint(pts[i]));
			var total = 0, lengths = [];
			for (var j = 1; j < px.length; j++) {
				var d = px[j].distanceTo(px[j - 1]);
				lengths.push(d);
				total += d;
			}
			if (total === 0) return null;
			var offset = iconSequence.offset === undefined ? "100%" : String(iconSequence.offset);
			var at = /%$/.test(offset) ? total * parseFloat(offset) / 100 : parseFloat(offset);
			at = clamp(at, 0, total);
			// find the segment
			var k = 0, run = 0;
			while (k < lengths.length - 1 && run + lengths[k] < at) {
				run += lengths[k];
				k++;
			}
			var a = px[k], b = px[k + 1];
			var t = lengths[k] ? (at - run) / lengths[k] : 1;
			var tip = L.point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
			var ux = (b.x - a.x) / (lengths[k] || 1), uy = (b.y - a.y) / (lengths[k] || 1);
			if (kind === SymbolPath.BACKWARD_CLOSED_ARROW || kind === SymbolPath.BACKWARD_OPEN_ARROW) {
				ux = -ux;
				uy = -uy;
			}
			var scale = symbol.scale || this.get("strokeWeight") || 3;
			var length = 5 * scale, half = 3 * scale;
			var base = L.point(tip.x - ux * length, tip.y - uy * length);
			var left = L.point(base.x + uy * half, base.y - ux * half);
			var right = L.point(base.x - uy * half, base.y + ux * half);
			var ll = [ lmap.layerPointToLatLng(left), lmap.layerPointToLatLng(tip), lmap.layerPointToLatLng(right) ];
			var color = symbol.strokeColor || this.get("strokeColor") || "#000000";
			var closed = kind === SymbolPath.FORWARD_CLOSED_ARROW || kind === SymbolPath.BACKWARD_CLOSED_ARROW;
			var style = {
				color: color,
				opacity: typeof symbol.strokeOpacity === "number" ? symbol.strokeOpacity : (typeof this.get("strokeOpacity") === "number" ? this.get("strokeOpacity") : 1),
				weight: typeof symbol.strokeWeight === "number" ? symbol.strokeWeight : (this.get("strokeWeight") || 3),
				fill: closed,
				fillColor: symbol.fillColor || color,
				fillOpacity: closed ? (typeof symbol.fillOpacity === "number" ? symbol.fillOpacity : 1) : 0,
				interactive: false,
				lineJoin: "round"
			};
			return closed ? L.polygon(ll, style) : L.polyline(ll, style);
		}
	});

	// --- Rectangle --------------------------------------------------------------------------------

	var Rectangle = vectorClass(function () {
		hidden(this, "closed_", true);
	}, {
		getBounds: function () { return this.get("bounds") || null; },
		setBounds: function (v) { this.set("bounds", v && !(v instanceof LatLngBounds) ? new LatLngBounds(v) : v); },
		hasGeometry_: function () {
			var b = this.get("bounds");
			return !!b && !b.isEmpty();
		},
		createLayer_: function (style) {
			return window.L.rectangle(boundsToL(this.get("bounds")), style);
		},
		geometryChanged_: function (key) {
			if (key !== "bounds") return;
			if (!this.layer_ || !this.hasGeometry_()) {
				this.rebuild_();
				return;
			}
			this.layer_.setBounds(boundsToL(this.get("bounds")));
		}
	});

	// =========================================================================================
	// Step 4e: Geocoder (Nominatim)
	// =========================================================================================

	var GeocoderStatus = {
		OK: "OK", ZERO_RESULTS: "ZERO_RESULTS", OVER_QUERY_LIMIT: "OVER_QUERY_LIMIT", REQUEST_DENIED: "REQUEST_DENIED",
		INVALID_REQUEST: "INVALID_REQUEST", UNKNOWN_ERROR: "UNKNOWN_ERROR", ERROR: "ERROR"
	};


	var geocodeQueue = [];
	var geocodeBusy = false;
	var geocodeLast = 0;
	var geocodeCache = {};

	function runGeocodeQueue() {
		if (geocodeBusy || !geocodeQueue.length) return;
		var wait = geocodeLast + config.geocoder.minInterval - new Date().getTime();
		if (wait > 0) {
			window.setTimeout(runGeocodeQueue, wait);
			return;
		}
		var job = geocodeQueue.shift();
		if (geocodeCache[job.url]) {
			deliverGeocode(job, geocodeCache[job.url].results, geocodeCache[job.url].status);
			runGeocodeQueue();
			return;
		}
		geocodeBusy = true;
		geocodeLast = new Date().getTime();
		var xhr = new window.XMLHttpRequest();
		var finished = false;
		function done(results, status) {
			if (finished) return;
			finished = true;
			geocodeBusy = false;
			if (status === GeocoderStatus.OK || status === GeocoderStatus.ZERO_RESULTS) {
				geocodeCache[job.url] = { results: results, status: status };
			}
			deliverGeocode(job, results, status);
			runGeocodeQueue();
		}
		xhr.open("GET", job.url, true);
		xhr.timeout = 15000;
		xhr.onload = function () {
			if (xhr.status === 429) return done([], GeocoderStatus.OVER_QUERY_LIMIT);
			if (xhr.status === 403) return done([], GeocoderStatus.REQUEST_DENIED);
			if (xhr.status < 200 || xhr.status >= 300) return done([], GeocoderStatus.ERROR);
			var data;
			try {
				data = JSON.parse(xhr.responseText);
			} catch (e) {
				return done([], GeocoderStatus.ERROR);
			}
			if (data && !(data instanceof Array)) data = data.error ? [] : [ data ];   // reverse returns one object
			var results = [];
			for (var i = 0; i < data.length; i++) {
				var r = nominatimToGoogle(data[i]);
				if (r) results.push(r);
			}
			done(results, results.length ? GeocoderStatus.OK : GeocoderStatus.ZERO_RESULTS);
		};
		xhr.onerror = function () { done([], GeocoderStatus.ERROR); };
		xhr.ontimeout = function () { done([], GeocoderStatus.ERROR); };
		xhr.send();
	}

	function deliverGeocode(job, results, status) {
		try {
			job.callback(results, status);
		} catch (e) {
			rethrowAsync(e);
		}
	}

	function component(longName, shortName, types) {
		return { long_name: String(longName), short_name: String(shortName || longName), types: types };
	}

	// Nominatim result -> google.maps.GeocoderResult (the fields Lightroom reads)
	function nominatimToGoogle(r) {
		if (!r || r.lat === undefined) return null;
		var a = r.address || {};
		var c = [];
		if (a.house_number) c.push(component(a.house_number, null, [ "street_number" ]));
		var road = a.road || a.pedestrian || a.footway || a.path || a.cycleway;
		if (road) c.push(component(road, null, [ "route" ]));
		if (a.neighbourhood || a.quarter) c.push(component(a.neighbourhood || a.quarter, null, [ "neighborhood", "political" ]));
		var sub = a.suburb || a.city_district || a.borough;
		if (sub) c.push(component(sub, null, [ "sublocality_level_1", "sublocality", "political" ]));
		var locality = a.city || a.town || a.village || a.hamlet;
		if (locality) c.push(component(locality, null, [ "locality", "political" ]));
		if (a.municipality && a.municipality !== locality) {
			c.push(component(a.municipality, null, [ "administrative_area_level_3", "political" ]));
		}
		var county = a.county || a.state_district;
		if (county) c.push(component(county, null, [ "administrative_area_level_2", "political" ]));
		var state = a.state || a.region || a.province;
		if (state) {
			var iso = a["ISO3166-2-lvl4"] || a["ISO3166-2-lvl6"] || "";
			c.push(component(state, iso.indexOf("-") > 0 ? iso.split("-")[1] : state, [ "administrative_area_level_1", "political" ]));
		}
		if (a.country) c.push(component(a.country, (a.country_code || a.country).toUpperCase(), [ "country", "political" ]));
		if (a.postcode) c.push(component(a.postcode, null, [ "postal_code" ]));

		var location = new LatLng(parseFloat(r.lat), parseFloat(r.lon));
		var viewport = null;
		if (r.boundingbox && r.boundingbox.length === 4) {
			var bb = r.boundingbox;   // [ south, north, west, east ] as strings
			viewport = new LatLngBounds(new LatLng(parseFloat(bb[0]), parseFloat(bb[2])), new LatLng(parseFloat(bb[1]), parseFloat(bb[3])));
		} else {
			viewport = new LatLngBounds(location, location);
		}
		var type = r.addresstype || r.type || "point_of_interest";
		return {
			formatted_address: r.display_name || "",
			address_components: c,
			geometry: {
				location: location,
				location_type: a.house_number ? "ROOFTOP" : "APPROXIMATE",
				viewport: viewport,
				bounds: viewport
			},
			place_id: (r.osm_type || "") + (r.osm_id || ""),
			types: [ type === "city" || type === "town" || type === "village" ? "locality" : type, "political" ]
		};
	}

	function Geocoder() {}
	Geocoder.prototype.geocode = function (request, callback) {
		request = request || {};
		var g = config.geocoder;
		var lang = request.language || (window.navigator && window.navigator.language) || "en";
		var params = [ "format=jsonv2", "addressdetails=1", "accept-language=" + encodeURIComponent(lang) ];
		if (g.email) params.push("email=" + encodeURIComponent(g.email));
		var url;
		var location = toLatLng(request.latLng || request.location);
		if (location) {
			params.push("lat=" + location.lat(), "lon=" + location.lng(), "zoom=18");
			url = g.url + "reverse?" + params.join("&");
		} else if (request.address) {
			params.push("q=" + encodeURIComponent(request.address), "limit=" + g.limit);
			var b = request.bounds;
			if (b && !b.isEmpty()) {
				var sw = b.getSouthWest(), ne = b.getNorthEast();
				// a hint, not a filter (like Google's bounds)
				params.push("viewbox=" + [ sw.lng(), ne.lat(), ne.lng(), sw.lat() ].join(","), "bounded=0");
			}
			url = g.url + "search?" + params.join("&");
		} else {
			window.setTimeout(function () { deliverGeocode({ callback: callback }, [], GeocoderStatus.INVALID_REQUEST); }, 0);
			return;
		}
		geocodeQueue.push({ url: url, callback: callback });
		window.setTimeout(runGeocodeQueue, 0);
	};

	// =========================================================================================
	// Namespace
	// =========================================================================================

	extend(maps, {
		version: "3.12-shim-" + SHIM_VERSION,
		shimVersion: SHIM_VERSION,
		visualRefresh: true,
		LatLng: LatLng,
		LatLngBounds: LatLngBounds,
		Point: Point,
		Size: Size,
		MarkerImage: MarkerImage,
		MVCObject: MVCObject,
		MVCArray: MVCArray,
		MapsEventListener: MapsEventListener,
		event: event,
		Map: Map,
		MapTypeId: MapTypeId,
		MapTypeRegistry: MapTypeRegistry,
		StyledMapType: StyledMapType,
		ControlPosition: ControlPosition,
		StreetViewPanorama: StreetViewPanorama,
		OverlayView: OverlayView,
		Marker: Marker,
		Circle: Circle,
		Polyline: Polyline,
		Rectangle: Rectangle,
		Geocoder: Geocoder,
		GeocoderStatus: GeocoderStatus,
		Animation: Animation,
		SymbolPath: SymbolPath,
		ElevationStatus: { OK: "OK", INVALID_REQUEST: "INVALID_REQUEST", OVER_QUERY_LIMIT: "OVER_QUERY_LIMIT",
			REQUEST_DENIED: "REQUEST_DENIED", UNKNOWN_ERROR: "UNKNOWN_ERROR" },
		MaxZoomStatus: { OK: "OK", ERROR: "ERROR" },
		// Control and style constants. Lightroom draws its own controls, so the shim ignores
		// these options, but the constants must exist: other Lightroom 6 builds use some of
		// them in their map options (e.g. MapTypeControlStyle.DROPDOWN_MENU).
		MapTypeControlStyle: { DEFAULT: 0, HORIZONTAL_BAR: 1, DROPDOWN_MENU: 2, INSET: 3, INSET_LARGE: 4 },
		ZoomControlStyle: { DEFAULT: 0, SMALL: 1, LARGE: 2 },
		NavigationControlStyle: { DEFAULT: 0, SMALL: 1, ANDROID: 2, ZOOM_PAN: 3 },
		ScaleControlStyle: { DEFAULT: 0 },
		StrokePosition: { CENTER: 0, INSIDE: 1, OUTSIDE: 2 },
		UnitSystem: { METRIC: 0, IMPERIAL: 1 }
		// MaxZoomService and ElevationService are intentionally absent; Lightroom checks for them.
	});

	window.google = window.google || {};
	window.google.maps = maps;

	// for unit tests under Node.js
	if (typeof module === "object" && module.exports) module.exports = maps;

	// -----------------------------------------------------------------------------------------
	// Loader: load Leaflet, then call the callback named in this script's URL
	// -----------------------------------------------------------------------------------------

	function currentScriptSrc() {
		if (!document) return "";
		if (document.currentScript && document.currentScript.src) return document.currentScript.src;
		var scripts = document.getElementsByTagName("script");
		for (var i = scripts.length - 1; i >= 0; i--) {
			if (/mapfix-shim[^\/]*\.js/.test(scripts[i].src)) return scripts[i].src;
		}
		return "";
	}

	// All values of a query parameter. Lightroom loads the shim through its resource proxy as
	// ".../cache://https%3A//host/mapfix-shim.js%3Fsensor=false&v=...", so "?" may appear as "%3F".
	function queryParams(url, name) {
		var re = new RegExp("(?:[?&]|%3[fF])" + name + "=([^&#]*)", "g");
		var values = [], match;
		while ((match = re.exec(url)) !== null) {
			try {
				values.push(decodeURIComponent(match[1]));
			} catch (e) {
				values.push(match[1]);
			}
		}
		return values;
	}

	function queryParam(url, name) {
		var values = queryParams(url, name);
		return values.length ? values[values.length - 1] : null;
	}

	/*
	 * Choosing another shim. Lightroom puts its API version setting into the script URL as
	 * "v=..." (config.lua: locationModule = { api_version = "..." }). Without that setting it
	 * is Lightroom's default "3.52"; the last v= in the URL wins.
	 *   "v1.2.3" or "1.2.3"            load that release from RELEASE_URL
	 *   "https://example.org/x.js"    load the shim from that URL (no "?" or "&" in it)
	 *   anything else                 use this file
	 * Only when the page passed a callback (the map page; the reverse geocoding page loads
	 * the shim synchronously and keeps using this file).
	 */
	function requestedShimUrl(v) {
		if (!v) return null;
		if (/^(https?:)?\/\//i.test(v)) return v;
		if (/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.\-]+)?$/.test(v)) return RELEASE_URL.replace("{version}", v);
		return null;
	}

	function loadRequestedShim(src) {
		var callback = queryParam(src, "callback");
		if (!callback || queryParam(src, "lrshim_redirected")) return false;
		var target = requestedShimUrl(queryParam(src, "v"));
		if (!target) return false;
		var url = target + (target.indexOf("?") >= 0 ? "&" : "?") +
			"callback=" + encodeURIComponent(callback) + "&lrshim_redirected=1";
		loadScript(url, null, function (ok) {
			if (!ok) reportLoadFailure("could not load the map shim from " + target);
		});
		return true;
	}

	// A failure to load reaches Lightroom as a JavaScript error, and Lightroom then shows its
	// usual "Map is offline" screen instead of an empty map.
	var loadFailureReported = false;
	function reportLoadFailure(message) {
		if (loadFailureReported) return;
		loadFailureReported = true;
		warn(message);
		var error = new Error("mapfix-shim: " + message);
		reportToLightroom(error);
		window.setTimeout(function () { throw error; }, 0);
	}

	// Lightroom's map page defines callCallback(); its "onError" switches the map to offline.
	function reportToLightroom(e) {
		try {
			if (typeof window.callCallback === "function") {
				// single line: Lightroom's callCallback() doesn't escape line breaks
				var oneLine = function (v) { return String(v || "").replace(/[\r\n]+\s*/g, " | "); };
				window.callCallback("onError", oneLine(e && e.message), oneLine(e && e.name), 0, oneLine(e && e.stack));
			}
		} catch (ignored) {
			// nothing else to do
		}
	}

	function loadStylesheet(href, integrity, done) {
		var link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		if (integrity) {
			link.integrity = integrity;
			link.crossOrigin = "anonymous";
		}
		link.onload = function () { done(true); };
		link.onerror = function () { done(false); };
		(document.head || document.getElementsByTagName("head")[0]).appendChild(link);
	}

	function loadScript(src, integrity, done) {
		var script = document.createElement("script");
		script.src = src;
		if (integrity) {
			script.integrity = integrity;
			script.crossOrigin = "anonymous";
		}
		script.onload = function () { done(true); };
		script.onerror = function () { done(false); };
		(document.head || document.getElementsByTagName("head")[0]).appendChild(script);
	}

	// Loads Leaflet's script and stylesheet; done() runs only if the script loaded in time.
	function loadLeaflet(done) {
		if (window.L && window.L.map) {
			window.setTimeout(done, 0);
			return;
		}
		var pending = 2, scriptOk = false, finished = false;
		var timer = window.setTimeout(function () {
			if (finished) return;
			finished = true;
			reportLoadFailure("Leaflet did not load within " + (config.leaflet.timeout / 1000) + " s from " + config.leaflet.js);
		}, config.leaflet.timeout);
		function step() {
			pending--;
			if (pending > 0 || finished) return;
			finished = true;
			window.clearTimeout(timer);
			if (scriptOk && window.L && window.L.map) done();
			else reportLoadFailure("could not load Leaflet from " + config.leaflet.js);
		}
		loadStylesheet(config.leaflet.css, config.leaflet.cssIntegrity, function (ok) {
			if (!ok) warn("could not load " + config.leaflet.css + "; the map may look wrong");
			step();
		});
		loadScript(config.leaflet.js, config.leaflet.jsIntegrity, function (ok) {
			scriptOk = ok;
			step();
		});
	}

	if (document) {
		var callbackName = queryParam(SELF_SRC, "callback");
		if (callbackName) {
			loadLeaflet(function () {
				var callback = window[callbackName];
				if (typeof callback !== "function") {
					warn("callback " + callbackName + " not found");
					return;
				}
				try {
					callback();
				} catch (e) {
					// The map couldn't be set up. Tell Lightroom directly, so it shows "Map is
					// offline" instead of an empty map, and rethrow for window.onerror.
					reportToLightroom(e);
					rethrowAsync(e);
				}
			});
		}
	}
})(typeof window !== "undefined" ? window : this);
