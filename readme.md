# A client-side viewshed tool using the [Esri JavaScript API](https://developers.arcgis.com/javascript/)

## [Demo](https://solowt.github.io/Client-side-viewshed/)

## Important information: 

  * May run out of memory if `pixelWidth` too low or radius is too high.
  * The viewshed algorithm is something like the "RFVS algorithm" described [here](http://www.geoinfo.info/proceedings_geoinfo2013.split/paper9.pdf).
  * In order to rasterize the lines, I used [Bresenham's algorithm](https://en.wikipedia.org/wiki/Bresenham's_line_algorithm).
  * In order to trace the polygon rings, I used the [potrace algorithm](http://potrace.sourceforge.net/potrace.pdf).

## Example (for an example without Web Workers, see `index.js`):

```js
require({
  packages: [
    { name: "ClientVS", location: location.href.replace(/\/[^/]+$/, ''), main: 'ClientVS' }
  ]
}, [
  "esri/core/workers",
  "esri/Map",
  "esri/views/SceneView",
  "esri/Graphic",
  "esri/geometry/Polygon",
  "dojo/domReady!"
], function(workers, Map, SceneView, Graphic, Polygon) {

  const map = new Map({
    basemap: "satellite",
    ground: "world-elevation"
  });

  const view = new SceneView({
    container: "viewDiv",
    map: map,
    zoom: 15,
    center: {
      x: -11268848.469625855,
      y: 2485519.681513185,
      spatialReference: { wkid: 102100 }
    }
  });

  let sampler;
  view.watch("groundView.elevationSampler", value => sampler = value);

  clearbtn.addEventListener('click', e => view.graphics.removeAll());

  const vsFill = {
    type: "simple-fill",
    color: [130, 242, 145, 0.5],
    outline: {
      color: [0, 0, 0],
      width: 2
    }
  };

  const local = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
  const workerUrl = `${local}/ClientVS.js`;
  let workerConnection;

  const workerPromise = workers.open(workerUrl, {
    strategy: "dedicated"
  });

  workerPromise.then(connection => {
    workerConnection = connection;
  })
  .catch(e => console.log(e));


  view.on('click', e => {
    const p = e.mapPoint.clone();

    const elevation = sampler ? sampler.queryElevation(e.mapPoint).z : 0;
    p.z = elevation + parseInt(obsheight.value, 10);

    // add point symbol to show observer
    view.graphics.add(new Graphic({
      geometry: p,
      symbol: {
        type: "simple-marker",
        style: "circle",
        color: "blue",
        size: "10px",
        outline: {
          color: [ 0, 0, 0 ],
          width: 3
        }
      }
    }));

    workerPromise.then(() => {
      workerConnection.invoke("doClientVS", {
        inputGeometry: e.mapPoint.toJSON(),            // observer position
        radius: parseInt(radius.value, 10),            // radius in meters
        pixelWidth: parseInt(resolution.value, 10),    // resolution of viewshed in meters
        observerHeight: parseInt(obsheight.value, 10)  // height observer in meters
      })
      .then(polygon => {

        view.graphics.add(
          new Graphic({
            geometry: Polygon.fromJSON(polygon),
            symbol: vsFill
          })
        );
      })
      .catch(e => console.log(e));
    });
  });
});

```