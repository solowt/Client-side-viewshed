require({
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
    ClientVS ) 
{
  let map = new Map({
    basemap: "satellite",
    ground: "world-elevation"
  });

  let view = new SceneView({
    container: "viewDiv",
    map: map,
    zoom: 15,
    center: [-101.17, 21.78]
  });

  let vsFill = new SimpleFillSymbol({
    color: new Color([130, 242, 145, 0.5]),
    outline: { // autocasts as new SimpleLineSymbol()
      color: new Color([0, 0, 0]),
      width: 2
    }
  });

  // create a new viewshed calculator
  let vs = new ClientVS(view);

  view.on('click', e => {
    // resolves into a single polygon multiringed polygon
    vs.doClientVS({
      inputGeometry: e.mapPoint, // observer position
      radius: 2000, // radius in meters
      pixelWidth: 20, // resolution of viewshed in meters
      observerHeight: 2, // height observer in meters
      objectHeight: 0, // height of the thing being observed, 0 for ground
    }).then(polygon => {
      let g = new Graphic({
        geometry: polygon,
        symbol: vsFill
      });
      view.graphics.add(g);
    });
  });
});
