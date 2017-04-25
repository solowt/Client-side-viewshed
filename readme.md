# A client-side viewshed tool using the [Esri JavaScript API](https://developers.arcgis.com/javascript/)

## [Demo](https://solowt.github.io/Client-side-viewshed/)

## Why?

I wanted to learn something about raster analysis, polygon drawing rules in the JS API, and how elevation data is handled by the API.

Generally this kind of calculation is done on the back-end, because that's where the elevation data is.  However, if you are using a [3D scene](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-SceneView.html) with an elevation layer added to it, the browser has a lot of elevation data that it uses to render the terrain.  There's no reason you can't use this data to do some computations.

If you don't have elevation data, you can use Esri's world elevation layer for free by setting the `ground` property of the map to `'world-elevation'`.  See: https://developers.arcgis.com/javascript/latest/api-reference/esri-Map.html#ground

## Important information: 

  * This tool will only work if you are using a 3D scene view with elevation added to it.
  * The calculation will be done using whatever data the browser has when you call the `doClientVS` function.  If you aren't zoomed in, the data might be lower resolution, and the results may be worse.
  * If you set the `pixelWidth` too low, it will probably crash your browser.  Pixel width (Resolution) and radius are the main inputs you have to be careful of.
  * The viewshed algorithm is something like the "RFVS algorithm" described [here](http://www.geoinfo.info/proceedings_geoinfo2013.split/paper9.pdf).
  * In order to rasterize the lines, I used [Bresenham's algorithm](https://en.wikipedia.org/wiki/Bresenham's_line_algorithm).
  * In order to trace the polygon rings, I used the [potrace algorithm](http://potrace.sourceforge.net/potrace.pdf).

## Example:

```js
require({ // dojo loader magic to load a local module along with CDN modules
	packages: [
    	{ name: "ClientVS", location: location.pathname.replace(/\/[^/]+$/, ''), main: 'ClientVS' }
    ]
},[
	"esri/Map",
  	"esri/views/SceneView",
  	"esri/symbols/SimpleFillSymbol",
  	"esri/Color",
  	"esri/Graphic",
  	"ClientVS",
  	"dojo/domReady!"
], function( Map, SceneView,
    SimpleFillSymbol,
    Color, Graphic,
    ClientVS ) // last module is in ClientVS.js
{

	// create map, set ground to world elevation service
	let map = new Map({
		basemap: "satellite",
		ground: "world-elevation"
	});

	// create scene view
	let view = new SceneView({
	    container: "viewDiv",
	    map: map,
	    zoom: 15,
	    center: [-101.17, 21.78]
	});

	// the symbol to render the polygon graphic later
	let vsFill = new SimpleFillSymbol({
	    color: new Color([130, 242, 145, 0.5]),
	    outline: {
	    	color: new Color([0, 0, 0]),
	     	width: 2
	    }
	});

	// create a new viewshed calculator, pass in the view
	let vs = new ClientVS(view);

	// add a click event to the view
	view.on('click', e => {
		// resolves into a single polygon multiringed polygon
	    vs.doClientVS({
	      	inputGeometry: e.mapPoint, // observer position
	        radius: 2000, // radius in meters
	        pixelWidth: 20, // resolution of viewshed in meters.  width of each pixel
	        observerHeight: 2 // height of the observer in meters
	    }).then(polygon => { // resolves to polygon geometry
    	
    	let g = new Graphic({
        	geometry: polygon,
        	symbol: vsFill
      	});
      	
      	// add polygon to map
      	view.graphics.add(g);
    });
  });
});
```

## Speeding up the calculation

There are various ways you might speed up this calculation.  One would be seeing how much can be offloaded to another thread (web worker).  The problem here is that the most expensive part of the computation involves doing several thousand lookups in the elevation raster, and this lookup occurs on the view.  To make good use of a web worker, a lot of data would have to be copied to the web worker's context, along with the logic to do the lookup and bilinear interpolation.  I don't really anything about the ovearhead of copying between threads, but this might be worth trying.

Another method would be doing the computation on the underlying elevation rasters themselves, rather than by querying the view which in turn does a lookup in the rasters.  In order to get this to work, you'd need to stitch together a few different elevation tiles in cases where the viewshed circle overlaps more than one tile.  This is certainly possible but it would be a fair amount of work.

If you succeeded in using the underlying rasters, you could probably offload all the real work to the GPU as the "can point X see point Y" calculations themselves are pretty straightforward and it doesn't take much imagination to convert them to GLSL.