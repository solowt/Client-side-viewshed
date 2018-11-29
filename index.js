require({
  packages: [
      { name: "ClientVS", location: location.href.replace(/\/[^/]+$/, ''), main: 'ClientVS' }
    ]
},[
  "esri/Map",
  "esri/views/SceneView",
  "esri/symbols/SimpleFillSymbol",
  "esri/Color",
  "esri/Graphic",
  "esri/geometry/Point",
  "esri/symbols/SimpleMarkerSymbol",
  "ClientVS",
  "dojo/domReady!"
], function( Map, SceneView,
    SimpleFillSymbol,
    Color, Graphic,
    Point, SMS, ClientVS ) 
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

  clearbtn.addEventListener('click', e => view.graphics.removeAll());

  let vsFill = new SimpleFillSymbol({
    color: new Color([130, 242, 145, 0.5]),
    outline: { // autocasts as new SimpleLineSymbol()
      color: new Color([0, 0, 0]),
      width: 2
    }
  });

  // create a new viewshed calculator
  let vs = new ClientVS();

  view.on('click', e => {
    console.log(e.mapPoint);

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
    vs.doClientVS({
      inputGeometry: e.mapPoint, // observer position
      radius: parseInt(radius.value,10), // radius in meters
      pixelWidth: parseInt(resolution.value,10), // resolution of viewshed in meters
      observerHeight: parseInt(obsheight.value,10) // height observer in meters
    }).then(polygon => {
      
      let g = new Graphic({
        geometry: polygon,
        symbol: vsFill
      });

      view.graphics.add(g);
    });
  });
});
