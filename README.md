# Fixing the Map Module in Lightroom Classic

As of December 1, 2018, the Map functionality in non-subscription versions of Lightroom stopped working. Adobe [suggests](https://helpx.adobe.com/lightroom/kb/map-view-no-longer-supported.html) buying a subscription to Lightroom CC (USD 120/year) or to copy & paste GPS coordinates into your favorite search engine (LOL!). 

This project resurrects the lost functionality, without subscribing to Lightroom CC.

## Before you proceed: READ THIS FIRST

This procedure requires medium to advanced IT skills. Mistakes may break your installation of Lightroom! If you don't know what you are doing, ask your designated IT support person for help. **We are NOT your IT support person!**

Keep your Google Maps API key secret
- DO NOT SHARE the patched Lightroom module. It contains your personal Google Maps API key!
- DO REMOVE/HIDE the Google Maps API key when discussing  this process, this includes screenshots and videos!

Failing to protect your Google Maps API key may lead to unexpected charges to your Google Cloud account.

**WARRANTY VOID! We are NOT responsible for breaking your Lightroom installation. We are NOT responsible for any charges on your Google Cloud account.**

## Technical Background

### Why the Map module stopped working

Earlier this year, Google revamped the pricing model for embedding Google Maps into 3rd party applications, changing from free access or flat fees to [transaction based pricing](https://cloud.google.com/maps-platform/pricing/sheet/). The number of requests to the Google Maps APIs are counted, and after a threshold, a small fee is charged for every request.

Google's new pricing is not compatible with products that are licensed perpetually. With classic Lightroom, Adobe only got money once, but would have to pay Google each time you use the Map module. For Adobe, this is not a sustainable business model.

The Google Maps API key embedded in old versions of Adobe Lightroom expired on November 30, 2018.

## Step-by-step Procedure

### 1. Create your personal Google Maps API key

The first step in [this guide](https://developers.google.com/maps/documentation/javascript/get-api-key) will take you through the process. If you don't already have an account on the Google Cloud, this will also include creating the account and entering the billing details.

### 2. Restrict the Google Maps API key

As Lightroom only calls two APIs, we can restrict the Google Maps API key to these to limit the risk of abuse.
- Google Maps JavaScript API
- Geo Coding API (optional)

### 3. Locate and backup the Lightroom Map module

On Windows 10, Lightroom 6, 64-bit: /Program Files/Adobe/Lightroom/Location.lrmodule

Make a back-up copy of the file Location.lrmodule.

### 5. Extract the Lua files for patching

Use [Resource Hacker](http://www.angusj.com/resourcehacker/) to extract the Lua resources we need to patch:
- Open Location.lrmodule with Resource Hacker
- Expand the section LUA
- Export LOCATIONMAPVIEW.LUA
- Export AGREVERSEGEOCODESERVICE.LUA (optional)

### 6. Patch Lua files with your Google Maps API key

If you haven't already, install Python 3.
For each Lua file, use the patchluastr.py to replace Adobe's key with your personal Google Maps API key.
patchluastr original-file "client=gme-adobesystems" "key={your-api-key}" {patched-file-name}.bin

### 7. Update Lightroom Map module with patched Lua files

Use [Resource Hacker](http://www.angusj.com/resourcehacker/) to replace the Lua resources with their patched version.
