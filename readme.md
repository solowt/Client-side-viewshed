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

95% of the calculation time is spent doing lookups for elevation in the client-side elevation data store.  There are a few possible ways to speed this up.

You might copy the data as an array buffer to a web worker and perform the look ups there.  You could also attempt to "stitch" together different rasters and do the elevation lookups directly on the resulting raster, instead of having to search through the entire tile tree.

I might check out at least one of these options.
