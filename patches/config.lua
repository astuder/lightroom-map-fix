-- Lightroom config.lua for the mapfix shim (see README section "mapfix shim").
-- If you already have a config.lua, add the locationModule entries to it.

locationModule = {
	-- Look up addresses of photos (reverse geocoding) through the shim and OpenStreetMap's
	-- Nominatim service, instead of Adobe's Google geocoding service, which no longer works.
	enablePremiereLicense = false,

	-- Optional: use a specific release of the shim instead of the latest 1.x ...
	-- api_version = "v1.0.0",
	-- ... or your own copy (the URL must not contain "?" or "&").
	-- api_version = "https://example.org/lightroom/mapfix-shim.js",

	-- Optional: enable debug panel of the location module
	-- debugPanel = true,
}
