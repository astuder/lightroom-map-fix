> **AS OF NOVEMBER 21 2023, THE MAP FIX AS DOCUMENTED BELOW DOESN'T WORK ANY LONGER**
>
> **See issue [#41](https://github.com/astuder/lightroom-map-fix/issues/41#issuecomment-1820876162) for current status.**

# Fixing the Map Module in Lightroom Classic

As of December 1, 2018, the Map functionality in non-subscription versions of Lightroom stopped working. Adobe [suggests](https://helpx.adobe.com/lightroom/kb/map-view-no-longer-supported.html) buying a subscription to Lightroom CC (120 USD/year) or to copy & paste GPS coordinates into your favorite search engine (LOL!). 

This project resurrects the lost functionality, without subscribing to Lightroom CC.

To achieve this, we will modify Lightroom to use our own Google Maps API key instead of Adobe's. While we need a subscription with Google, that subscription includes 200 USD of free use credits per month, which should be sufficient for casual users of the Lightroom Map module.

### Table of contents
- [Before you start READ THIS FIRST](#before-you-start-read-this-first)
- [Step-by-step Procedure](#step-by-step-procedure)
- [More Hacks](#more-hacks)
- [Technical Background](#technical-background)
- [Reverse engineering notes](notes.md)

## Before you start READ THIS FIRST

This procedure requires medium to advanced IT skills. Mistakes may break your installation of Lightroom! If you don't know what you are doing, ask your designated IT support person for help. **We are NOT your IT support person!**

Keep your Google Maps API key secret
- DO NOT SHARE the patched Lightroom module. It contains your personal Google Maps API key!
- DO REMOVE/HIDE the Google Maps API key when discussing  this process, this includes screenshots and videos!

Failing to protect your Google Maps API key may lead to unexpected charges to your Google Cloud account.

> **WARRANTY VOID! We are NOT responsible for breaking your Lightroom installation. We are NOT responsible for any charges on your Google Cloud account.**

## Step-by-step Procedure

This procedure was developed and tested with Lightroom 6.14 on Windows 10.

Users reported that this also works with:
- Lightroom 6.14 Windows 7, 8, 10 and 11 
- Lightroom 6.14 Mac

Currently the patch DOES NOT work with Lightroom 5.x ([issue #8](https://github.com/astuder/lightroom-map-fix/issues/8)) or Lightroom 7.x ([issue #10](https://github.com/astuder/lightroom-map-fix/issues/10)). Please let us know if you make any progress on these versions by commenting in the open issues.

A big Thank You! to everyone that contributed with their research and feedback!

### 1. Create your personal Google Maps API key

You need to create your personal Google Maps API key to replace Adobe's.

The first section in [this guide](https://developers.google.com/maps/documentation/javascript/get-api-key) will take you through the process. If you don't already have an account on the Google Cloud, this will also include creating the account and entering the billing details.

### 2. Enable required Google Maps API services

Go to [APIs & Services > Library](https://console.cloud.google.com/apis/library) and filter by [Category > Maps](https://console.cloud.google.com/apis/library?filter=category:maps).

Select the following APIs and click Enable:
* [Maps JavaScript API](https://console.cloud.google.com/apis/library/maps-backend.googleapis.com?filter=category:maps)
* [Geocoding API](https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com?filter=category:maps).

### 3. Restrict the Google Maps API services

As Lightroom only calls two APIs, restrict the Google Maps API key to the required services to limit the risk of abuse.

![Screenshot of Google Maps API key restrictions](images/KeyRestrictions2.PNG)

The monthly free usage credits of Google Cloud should be enough for casual use of the Lightroom Map module. To avoid surprises, you should set [budgets](https://cloud.google.com/billing/docs/how-to/budgets) or [quotas](https://cloud.google.com/apis/docs/capping-api-usage). Budgets will send an email alert when a configured amount is exceeded, whereas quotas will turn off the API.

We recommend to configure a budget of 1 USD and a first alert at 10%. With this configuration, Google will send you an email if you spend more than 10 cents of your own money.

![Screenshot of budget configuration](images/Budget.PNG)

### 4. Backup the Lightroom Map module

If Lightroom is still running, close it now.

Locate the application files of Lightroom, and look for a file called `Location.lrmodule`. This is the Lightroom Map module. Make a backup copy of this file and keep it in a safe place.

The location and the file name may vary with the operating system and version of Lightroom.
- For Lightroom 6.14 on Windows, the Map module is the file `C:\Program Files\Adobe\Lightroom\Location.lrmodule`
- For Lightroom 6.14 on Mac, locate `/Applications/Adobe Lightroom/Adobe Lightroom.app`, right-click and select *Show Package Content*. The Map module is `/Contents/PlugIns/Location.agmodule`. 

> IMPORTANT NOTE: If you leave the backup copy in the original folder, the file extension must be changed (e.g. from Location.lrmodule to Location.lrmodule_bak). Otherwise it may still get picked up by Lightroom instead of the patched file.

### 5. Extract Lua files for patching

On Windows, use [Resource Hacker](http://www.angusj.com/resourcehacker/) to extract the Lua resources we need to patch:
- Open `Location.lrmodule` with Resource Hacker
- Expand the section `LUA`
- On `LOCATIONMAPVIEW.LUA`, right-click and select *save bin resource*
- On `AGREVERSEGEOCODESERVICE.LUA`, right-click and select *save bin resource*
- On `LOCATIONDEBUGPANEL.LUA`, right-click and select *save bin resource*

![Screenshot of Resource Hacker with save menu](images/ResourceHackerSave.PNG)

On Mac, the Lua files are directly accessible inside `Location.agmodule`:
- Right-click `Location.agmodel` and select *Show Package Content*
- Then navigate to `/Contents/Resources/`
- Copy the files `LocationMapView.lua`, `AgReverseGeocodeService.lua` and `LocationDebugPanel.lua` to the desired location for patching

### 6. Patch Lua files

If you haven't already, install [Python 3](https://www.python.org/downloads/).

The Python script [patchluastr.py](patchluastr.py) supplied with this project enables you to replace certain strings in Lua files.

For LocationMapView and AgReverseGeocodeService, use the Python script [patchluastr.py](patchluastr.py) to replace Adobe's key with your personal Google Maps API key:

- Open a command prompt, navigate to the folder where you stored patchluastr.py.
- On Windows the name of the patched Lua file must end with `.bin`, otherwise Resource Hacker won't find it in the next step. Run `patchluastr.py` as follows, replacing `{your-api-key}` with your Google API key (without curly brackets):
```
patchluastr.py LOCATIONMAPVIEW.LUA "client=gme-adobesystems" "key={your-api-key}" -o LOCATIONMAPVIEW.tmp
patchluastr.py LOCATIONMAPVIEW.tmp "3.12" "3.51" -o LOCATIONMAPVIEW.bin
patchluastr.py AGREVERSEGEOCODESERVICE.LUA "client=gme-adobesystems" "key={your-api-key}" -o AGREVERSEGEOCODESERVICE.bin
```

- On Mac, the name of the patched Lua file must be identical with the original file. The easiest is to first rename the orignal file, e.g. to `orignal-name.lua.bak`. Then run `patchluastr.py` as follows, replacing `{your-api-key}` with your Google API key (without curly brackets):
```
patchluastr.py LocationMapView.lua.bak "client=gme-adobesystems" "key={your-api-key}" -o LocationMapView.lua.tmp
patchluastr.py LocationMapView.lua.tmp "3.12" "3.51" -o LocationMapView.lua
patchluastr.py AgReverseGeocodeService.lua.bak "client=gme-adobesystems" "key={your-api-key}" -o AgReverseGeocodeService.lua
```

With the file LocationDebugPanel, use the Python script [patchluastr.py](patchluastr.py) to disable the signature check:
- Open a command prompt, navigate to the folder where you stored patchluastr.py.
- On Windows run:
```
patchluastr.py LOCATIONDEBUGPANEL.LUA "nature" "street" -o LOCATIONDEBUGPANEL.bin
```
- On Mac run:
```
patchluastr.py LocationDebugPanel.lua.bak "nature" "street" -o LocationDebugPanel.lua
```

If running the patchluastr.py fails with an error like for example `TypeError: unsupported operand type(s)`, make sure that you have Python 3 installed. If you have multiple versions of Python installed, you can explicitly run the script with Python 3 by prefixing the command with `python3`:
```
python3 patchluastr.py {original-file} "client=gme-adobesystems" "key={your-api-key}" -o {patched-file}.lua
```

__Experimental__: For Windows users that don't want to install Python, I made an executable version of `patchluastr` available [here](https://github.com/astuder/lightroom-map-fix/blob/master/patchluastr-win10.zip), which does not require to install Python. The command line is:
```
patchluastr.exe {original-file} "client=gme-adobesystems" "key={your-api-key}" -o {patched-file}.bin
```

> __Note__: Some users report requiring additional patches. If you can't get the map working or the map stops working, check out [issue #12](https://github.com/astuder/lightroom-map-fix/issues/12#issuecomment-499776944) and [issue #19](https://github.com/astuder/lightroom-map-fix/issues/19#issuecomment-502568837). We didn't see this issue in the US, so it may depend on your country.

### 7. Update Lightroom Map module with patched Lua files

On Windows, use [Resource Hacker](http://www.angusj.com/resourcehacker/) to replace the Lua resources with their patched version.
- Open `Location.lrmodule` with Resource Hacker
- Expand the section `LUA`
- On `LOCATIONMAPVIEW.LUA`, right-click and select *Replace Resource*, then click *Select File* and navigate to the patched version of this resource. Then click *Replace*
- On `AGREVERSEGEOCODESERVICE.LUA` right-click and select *Replace Resource*, then click *Select File* and navigate to the patched version of this resource. Then click *Replace*.
- On `LOCATIONDEBUGPANEL.LUA` right-click and select *Replace Resource*, then click *Select File* and navigate to the patched version of this resource. Then click *Replace*
- Save `Location.lrmodule`. Depending on permissions, you may have to use *Save as* and then copy the modified file back into `C:\Program Files\Adobe\Lightroom\`
- The patched version of Location.lrmodule may be significantly smaller than the original. Don't worry :-)

![Screenshot of Resource Hacker with replace menu](images/ResourceHackerReplace.PNG)

On Mac, copy the patched Lua files back into `/Applications/Adobe Lightroom/Adobe Lightroom.app/Contents/PlugIns/Location.agmodule/Contents/Resources/`, overwriting the original files.

### 8. Enjoy!

The Map module in your installation of Lightroom now works again.

If you didn't enable Geo Coding API, you will briefly see error messages. However, the basic map and geo tagging functionality will still work.(Note: Some users report that the map module didn't work for them unless the Geo Coding API is activated)

## More Hacks

**Make double-sure you have a backup of Locations.lrmodule before playing with these!**

The examples below use patch files, which can be found in the folder `hacks`. If you haven't yet, we recommend to clone or download the complete project from Github, for example by clicking the green button on the top right of this page.

Note: Most of these hacks build on the Google Maps API and therefore still require fixing the Google Maps API key first.

- [OpenStreetMap Map Style](#openstreetmap-map-style)
- [Google Street View](#google-street-view)
- [Google Maps Tilt View](#google-maps-tilt-view)
- [Extended Map Selector](#extended-map-selector)
- [JavaScript Console](#javascript-console)

### OpenStreetMap Map Style

This patch replaces the "Light" map style with [OpenStreeMap](https://www.openstreetmap.org). 

After patching the API key, execute:
```
patchluastr.py LOCATIONMAPVIEW.bin -p hacks/osm.patch -o LOCATIONMAPVIEW-osm.bin
```

Now use `LOCATIONMAPVIEW-osm.bin` with Resource Hacker instead of `LOCATIONMAPVIEW.bin`, and afterwards OpenStreetMap is available as the "Light" map style.

![Lightroom 6 with OpenStreetMap map style](images/OpenStreetMapStyle.PNG)

Credit for hack: [@pbb72](https://github.com/pbb72)

### Google Street View

This is quite radical; if we enable StreetView, then we can see our map pins in 3-D! It's not very precise, but it's just very cool.

There is already code in place in the Lightroom file to enable StreetView, so apparently Adobe has been working on it, but maybe turned it off because it was not good enough.

To enable this hidden feature, run:
```
patchluastr.py LOCATIONMAPVIEW.bin -p hacks/streetview.patch -o LOCATIONMAPVIEW-sv.bin
```

![Google Street View in Lightroom 6](images/StreetView.jpg)

Credit for hack and screenshot: [@pbb72](https://github.com/pbb72)

### Google Maps Tilt View

Some locations on earth offer aerial photos with a diagonal perspective (instead of a top-down view). Note: these photos are not very precise.

To enable this control, run:
```
patchluastr.py LOCATIONMAPVIEW.bin -p hacks/tiltmap.patch -o LOCATIONMAPVIEW-tilt.bin
```

With this patch, new controls will appear on the bottom right if the data is available for the current location. You may have to zoom in for the control to appear.

![Google Maps tilt view](images/TiltMap.jpg)

Credit for hack: [@pbb72](https://github.com/pbb72)

### Extended Map Selector

We can't add more maps to Lightroom's map style selector (we think). But luckily Google Maps offers their own map style selector, which we just need to enable.

Once enabled, we can add our own entries to the drop-down menu. See comments inside
the patch file for more information.

```
patchluastr.py LOCATIONMAPVIEW.bin -p hacks/mapselector.patch -o LOCATIONMAPVIEW-sel.bin
```

![New drop-down menu with custom map styles](images/MapSelector.jpg)

Credit for hack: [@pbb72](https://github.com/pbb72)

### JavaScript Console

This patch displays JavaScript error and debug messages in a window below the map, which will be very helpful when developing more hacks. You probably don't want this enabled permanently, so make a backup of the Locations module before applying this hack.

Run the hacks/jsconsole.patch script:
```
patchluastr.py LOCATIONMAPVIEW.bin -p hacks/jsconsole.patch -o LOCATIONMAPVIEW-con.bin
```

The script does the following:
1. Reduce the map window size.
1. Make text output readable.
1. Install a script to redirect console output to the window

Now enjoy actually readable error messages!

![JavaScript error messages displayed below map window in Lightroom 6](images/JavaScriptConsole.PNG)

Credit for hack and screenshot: [@pbb72](https://github.com/pbb72)

## Technical Background

- [Why the Map module stopped working](#why-the-map-module-stopped-working)
- [Google Maps JavaScript API](#google-maps-javascript-api)
- [Google Geocoding API](#google-geocoding-api)
- [Reverse Geocoding](#reverse-geocoding)
- [Google billing](#google-billing)

### Why the Map module stopped working

In early 2018, Google revamped the pricing model for embedding Google Maps into 3rd party applications, changing from free access or flat fees to [transaction based pricing](https://cloud.google.com/maps-platform/pricing/sheet/). The number of requests to the Google Maps APIs are counted, and after a threshold, a small fee is charged for every request.

Google's new pricing is not compatible with products that are licensed perpetually. With classic Lightroom, Adobe only got money once, but would have to pay Google each time you use the Map module. For Adobe, this is not a sustainable business model.

The Google Maps API key embedded in old versions of Adobe Lightroom expired on November 30, 2018.

### Google Maps JavaScript API

The [Google Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/tutorial) allows to embed Google Maps into websites and applications.

As of December 2018, Google Maps JavaScript API [costs 0.007 USD per map load](https://developers.google.com/maps/documentation/javascript/usage-and-billing) (USD 7 / 1000). Once a map is loaded, user interactions with the map, such as panning, zooming or switching map layers, do not generate additional map loads.

In addition, as of March 2023, the version of the API requested by Lightroom was deprecated, which caused Lightroom to load an incompatible version, breaking the maps functionality.

The Lightroom Map module calls the Maps JavaScript API to show the map inside Lightroom. Access to this API is required for the Map module to work.

Access to this API is implemented in the Lua resource LOCATIONMAPVIEW.LUA.

### Google Geocoding API

The Google Geocoding API allows applications to search locations and lookup place names based on GPS coordinates.

As of December 2018, Google Geocoding API [costs 0.005 USD per request](https://developers.google.com/maps/documentation/geocoding/usage-and-billing) (5 USD / 1000).

The Lightroom Map module calls the Geocoding API to display the place name of the currently selected image and when searching for a location. The Map module works without access to this API, but will briefly flashing an error message when entering the Map module and when switching between images.

![Screenshot of place name on map in Lightroom](images/GeocodingMap.PNG)

We observed multiple calls to the Geocoding API when entering the Map module. We also don't know, what other operations will create calls to this API. We recommend to keep a close eye on the usage reports available on the Google Cloud Platform. If in doubt or too costly, disable access to the Geocoding API by removing the service from the API restrictions under [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials/key).

Access to this API is implemented in the Lua resource AGREVERSEGEOCODESERVICE.LUA.

### Reverse Geocoding

For reverse geocoding (adding the location name to image metadata based on known coordinates) Lightroom accesses the Google API with the query parameter `signature` which seems to be calculated based on Adobe's (expired) API key and your Lightroom license key. The offending API call looks like:

```
http://maps.google.com/maps/api/geocode/json?key=[api-key]&language=EN&channel=lightroom-6.14&latlng=[coordinates-of-my-photo]&signature=[string-of-characters]
```

Fortunately for us, while the Google API denies access with an expired signature, the API does work if `signature=[string-of-characters]` is removed from the URL, or when `signature` is replaced with an unknown parameter name. Unfortunately, the string `signature` does not exist in any Lua file.

It turns out the functionality is hidden by breaking up strings. The signature is calculated in `LocationDebugPanel.lua` and the string `nature` in that file is part of the parameter name `signature`. Replacing `nature` with `street` will change the API call to:
```
http://maps.google.com/maps/api/geocode/json?key=[api-key]&language=EN&channel=lightroom-6.14&latlng=[coordinates-of-my-photo]&sigstreet=[string-of-characters]
```
which Google happily accepts.

### Google billing

Starting in 2018, Google requires an account on Google Cloud Platform that is enabled for billing. All Google Maps API transactions are charged against that account. Luckily for us, Google gives each account a monthly credit of 200 USD. Only transactions exceeding that limit will be billed to your credit card.

Costs and terms of service may differ by country. Please carefully review details on [Google's website](https://developers.google.com/maps/billing/understanding-cost-of-use#billing-overview).

200 USD is enough for over 28000 map loads or 40000 calls to the Geo Coding API, which should be enough for casual use of the Lightroom Map module. To avoid surprises, you can set [budgets](https://cloud.google.com/billing/docs/how-to/budgets) or [quotas](https://cloud.google.com/apis/docs/capping-api-usage). Budgets will send an email alert when a configured amount is exceeded, whereas quotas will turn off the API.

We recommend to configure a budget of 1 USD and a first alert at 10%. With this configuration, Google will send you an email if you spend more than 10 cents of your own money.

![Screenshot of budget configuration](images/Budget.PNG)
