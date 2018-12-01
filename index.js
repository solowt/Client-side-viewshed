require({
  packages: [
    { name: "ClientVS", location: location.href.replace(/\/[^/]+$/, ''), main: 'ClientVS' }
  ]
}, [
  "ClientVS",
  "esri/Map",
  "esri/views/SceneView",
  "esri/Graphic",
  "esri/geometry/Polygon",
  "dojo/domReady!"
], function(VS, Map, SceneView, Graphic, Polygon) {

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

  const vs = new VS();

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

    vs.doClientVS({
      inputGeometry: e.mapPoint,                   // observer position
      radius: parseInt(radius.value,10),           // radius in meters
      pixelWidth: parseInt(resolution.value,10),   // resolution of viewshed in meters
      observerHeight: parseInt(obsheight.value,10) // height observer in meters
    }).then(polygon => {
      
      let g = new Graphic({
        geometry: Polygon.fromJSON(polygon),
        symbol: vsFill
      });

      view.graphics.add(g);
    });
  });
});
