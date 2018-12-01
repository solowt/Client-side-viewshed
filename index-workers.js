require({
  packages: [
      { name: "ClientVS", location: location.href.replace(/\/[^/]+$/, ''), main: 'ClientVS' }
    ]
},[
  "esri/core/workers",
  "esri/Map",
  "esri/views/SceneView",
  "esri/symbols/SimpleFillSymbol",
  "esri/Color",
  "esri/Graphic",
  "esri/geometry/Point",
  "esri/geometry/Polygon",
  "esri/symbols/SimpleMarkerSymbol",
  "dojo/domReady!"
], function( workers, Map, SceneView,
    SimpleFillSymbol,
    Color, Graphic,
    Point, Polygon, SMS ) 
{
  let map = new Map({
    basemap: "satellite",
    ground: "world-elevation"
  });

  let view = new SceneView({
    container: "viewDiv",
    map: map,
    zoom: 15,
    center: {
      x: -11268848.469625855,
      y: 2485519.681513185,
      spatialReference: { wkid: 102100 }
    }
  });

  clearbtn.addEventListener('click', e => view.graphics.removeAll());

  let vsFill = new SimpleFillSymbol({
    color: new Color([130, 242, 145, 0.5]),
    outline: { // autocasts as new SimpleLineSymbol()
      color: new Color([0, 0, 0]),
      width: 2
    }
  });

  let local = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
  let workerUrl = local + "/ClientVS.js";
  let workerConnection;

  let workerPromise = workers.open(workerUrl, {
    strategy: "dedicated"
  });

  workerPromise.then(connection => {
    workerConnection = connection;
  })
  .catch(e => console.log(e));

  view.on('click', e => {

    // add point symbol to show observer
    view.graphics.add(new Graphic({
      geometry: e.mapPoint,
      symbol: new SMS({
        style: "circle",
        color: "blue",
        size: "10px",
        outline: {
          color: [ 0, 0, 0 ],
          width: 3
        }
      })
    }));


    // resolves into a single polygon multiringed polygon
    workerPromise.
    then(() => {
      workerConnection.invoke("doClientVS", {
        inputGeometry: e.mapPoint.toJSON(), // observer position
        radius: parseInt(radius.value, 10), // radius in meters
        pixelWidth: parseInt(resolution.value, 10), // resolution of viewshed in meters
        observerHeight: parseInt(obsheight.value, 10) // height observer in meters
      })
      .then(polygon => {
        // console.log(JSON.stringify(polygon.rings));
        let g = new Graphic({
          geometry: Polygon.fromJSON(polygon),
          symbol: vsFill
        });

        view.graphics.add(g);
      })
      .catch(e => console.log(e));
    });
  });
});
