require([
  "esri/Map",
  "esri/views/SceneView",
  "esri/geometry/Point",
  "esri/geometry/geometryEngineAsync",
  "esri/symbols/SimpleFillSymbol",
  "esri/Color",
  "esri/geometry/support/webMercatorUtils",
  "esri/geometry/Circle",
  "esri/geometry/Polyline",
  "esri/Graphic",
  "esri/geometry/Polygon",
  "dojo/domReady!"
], function(Map, SceneView, Point, geoEngineAsync, SimpleFillSymbol,
            Color, wmUtils, Circle, Polyline, Graphic, Polygon)
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

  view.on('click', e => {
    doClientVS({
      inputGeometry: e.mapPoint,
      radius: 2000,
      pixelWidth: 20,
      observerHeight: 2,
      objectHeight: 2,
      view: view
    }).then(r => {console.log(r);view.graphics.add(r)});
  });

  // TODO: convert to webmercator.  add html file.  pull in jsapi modules handle earth curvature


  const elevationCache = new Map();

  const vsFill = new SimpleFillSymbol({
    color: new Color([130, 242, 145, 0.5]),
    outline: { // autocasts as new SimpleLineSymbol()
      color: new Color([0, 0, 0]),
      width: 2
    }
  });

  /**
  *
  * @param: {point} esriPoint - center of vs
  * @param: {radius} number - radius of vs (meters)
  * @param {resolution} number - width/height of pixel in meters, determines resolution of viewshed
  * options: {inputGeometry: any, radius: number, pixelWidth: number, observerHeight: number, objectHeight: number, view: any}
  */
  function doClientVS(options){
    return new Promise((fulfill, reject) => {
      let point = options.inputGeometry.spatialReference.isWGS84 ? wmUtils.geographicToWebMercator(options.inputGeometry) : options.inputGeometry,
          radius = options.radius || 5000,
          resolution = options.pixelWidth || 10,
          subjectHeight = options.observerHeight || 2,
          objectHeight = options.objectHeight,
          view = options.view;

      let circle = buildCircle([point.longitude, point.latitude], radius);
      buildBounds(circle, resolution).then(bounds => {
        let xAxis = bounds.find((l)=>l.name === 'x').line.paths[0];
        let yAxis = bounds.find((l)=>l.name === 'y').line.paths[0];
        let top = bounds.find((l)=>l.name === 'top').line.paths[0];
        let right = bounds.find((l)=>l.name === 'right').line.paths[0];

        let elevationRaster = new Array(xAxis.length * yAxis.length).fill(null);

        let raster = {
          view: view,
          pixels: new Array(xAxis.length * yAxis.length).fill(false),
          circle: circle,
          xAxis: xAxis,
          yAxis: yAxis,
          top: top,
          right: right,
          pixelsLength: xAxis.length * yAxis.length,
          pixelsWidth: xAxis.length,
          pixelsCenter: [Math.floor(xAxis.length/2),Math.floor(yAxis.length/2)],
          geoPointCenter: [xAxis[Math.floor(xAxis.length/2)][0],yAxis[Math.floor(yAxis.length/2)][1]],
          subjectHeight: subjectHeight,
          objectHeight: objectHeight
        }

        elevationRaster = elevationRaster.map((cell, index) => {
          let geoPoint = indexToGeoPoint(index, raster);
          return geoPointToElevation(wmUtils.webMercatorToGeographic(geoPoint), view);
        });

        raster.elevationRaster = elevationRaster;

        computeViewshed(raster).then(result => {
          
          let rings = result.map((r)=>r.points).sort((a,b)=>{
            if (a.length > b.length){
              return -1;
            } else if (a.length < b.length){
              return 1;
            } else {
              return 0;
            }
          });

          let newViewshed = new Graphic({
            geometry: new Polygon({
              rings: rings,
              spatialReference: { wkid: 3857 }
            }),
            symbol: vsFill
          });
          // let newViewshed = new Graphic({
          //   geometry: new Polygon({
          //     rings: [rings[0],rings[1]],
          //     spatialReference: { wkid: 4326 }
          //   }),
          //   symbol: this.vsFill
          // });
          fulfill(newViewshed);

        });
      });
    });

  }

  function buildCircle(center, radius){
    return new Circle({
      center: center,
      radius: radius,
      radiusUnit: 'meters',
      geodesic: true
    });
  }

  function hashCode(lng,lat){
    return lng.toString() + lat.toString();
  }

  function buildBounds(circle, resolution){
    let lineArray = [];

    lineArray.push({
      line: new Polyline({
        paths: [
          [circle.extent.xmin, circle.extent.ymin],
          [circle.extent.xmax, circle.extent.ymin]
        ]
      }),
      name: 'x'
    });

    lineArray.push({
      line: new Polyline({
        paths: [
          [circle.extent.xmin, circle.extent.ymin],
          [circle.extent.xmin, circle.extent.ymax]
        ]
      }),
      name: 'y'
    });

    lineArray.push({
      line: new Polyline({
        paths: [
          [circle.extent.xmin, circle.extent.ymax],
          [circle.extent.xmax, circle.extent.ymax]
        ]
      }),
      name: 'top'
    });

    lineArray.push({
      line: new Polyline({
        paths: [
          [circle.extent.xmax, circle.extent.ymax],
          [circle.extent.xmax, circle.extent.ymin]
        ]
      }),
      name: 'right'
    });

    return new Promise((resolve,reject) => {
      Promise.all(lineArray.map(line => {
        let wmLine = wmUtils.geographicToWebMercator(line.line);
        return geoEngineAsync.densify(wmLine, resolution, 9001).then(result => {
          return {
            name: line.name,
            line: result
          }
        });
      })).then(results => resolve(results));
    });
  }

  function computeViewshed(raster){
    /** SQUARE STUFF **/
    // let safeEdge = Math.min(raster.xAxis.length, raster.top.length, raster.yAxis.length,raster.right.length) - 1;
    // let safeHeight = Math.min(raster.yAxis.length, raster.right.length);

    // let right = new Array(safeEdge).fill(null).map((el,i)=>{
    //   return [safeEdge-1,i]
    // });
    // let left = new Array(safeEdge).fill(null).map((el,i)=>{
    //   return [0,i]
    // });

    // let top = new Array(safeEdge).fill(null).map((el,i)=>{
    //   return [i,safeEdge-1]
    // });

    // let bottom = new Array(safeEdge).fill(null).map((el,i)=>{
    //   return [i,0]
    // });
    // raster.pixelsWidth = safeWidth  - 1;
    // raster.pixelsLength = (safeWidth - 1) * (safeHeight - 1);

    // raster.pixels = raster.pixels.filter((px,i)=>{
    //   let point = this.indexToPoint
    // });

    let circleRadius = Math.min(raster.pixelsCenter[0],raster.pixelsCenter[1]) - 1;
    let circle = drawCircle(raster.pixelsCenter, circleRadius);


    return new Promise((resolve,reject)=>{
      // let square = left.concat(top,right,bottom);
      circle.forEach((point)=>{
        let line = drawLine(raster.pixelsCenter,point);
        let resultLine = testLine(line,raster);
        flipLine(resultLine,raster);
      });

      traceResult(raster,2).then((rings)=>{
        resolve(rings);
      });

    });
  }

  function countPixels(pixels){
    let numTrue = 0;
    let numFalse = 0;
    pixels.forEach((px)=>{
      if (px===true){
        numTrue++;
      } else {
        numFalse++
      }
    });

    return {
      true: numTrue,
      false: numFalse


    }
  }

  function pointToIndex(point,width,length){
    let idx = point[1] * width + point[0];
    if (idx < length && idx >= 0){
      return idx;
    } else {
      return null
    }
  }

  function indexToPoint(idx,width){
    const x = idx % width;
    const y = (idx - x) / width;
    return([x,y]);
  }

  function indexToGeoPoint(idx,raster){
    let point = indexToPoint(idx,raster.pixelsWidth);
    return pointToGeoPoint(point,raster);
  }

  function pointToGeoPoint(point,raster){
    return new Point({
      longitude: raster.xAxis[point[0]][0],
      latitude: raster.yAxis[point[1]][1],
      spatialReference: { wkid: 4326 }
    });
  }

  function pointToLngLat(point,raster){
    return [
      raster.xAxis[point[0]][0],
      raster.yAxis[point[1]][1]
    ]
  }

  function geoPointToElevation(point, view){
    let height = view.basemapTerrain.getElevation(point);
    return height;
  }

  function pointToElevation(point,raster){
    let idx = pointToIndex(point, raster.pixelsWidth, raster.pixelsLength);
    return raster.elevationRaster[idx];
    // let geoPoint = pointToGeoPoint(point,raster);
    // return geoPointToElevation(geoPoint,raster.view);
  }

  function distance(point1,point2){
    return Math.sqrt( (Math.pow(point2[0] - point1[0], 2)) + (Math.pow(point2[1] - point1[1], 2)) );
  }

  // bresenham
  function drawLine(point1, point2){
    let line = [];

    let deltaX = point2[0] - point1[0];
    let deltaY = point2[1] - point1[1];

    let dx1 = deltaX < 0 ? -1 : 1;
    let dy1 = deltaY < 0 ? -1 : 1;
    let dx2 = deltaX < 0 ? -1 : 1;
    let dy2 = 0;

    let longest = Math.abs(deltaX);
    let shortest = Math.abs(deltaY);

    if (!(longest>shortest)){
      longest = Math.abs(deltaY);
      shortest = Math.abs(deltaX);

      dy2 = deltaY < 0 ? -1 : 1;
      dx2 = 0;
    }

    let numerator = longest >> 1;

    let currX = point1[0];
    let currY = point1[1];

    for (let i = 0; i <= longest; i++){
      line.push([currX,currY]);
      numerator += shortest;

      if (!(numerator < longest)){
        numerator -= longest;
        currX += dx1;
        currY += dy1;
      } else {
        currX += dx2;
        currY += dy2;
      }
    }

    return line;
  }

  // draw a circle given a center and radius in raster space
  // angle for later to only computer viewshed for some angle
  function drawCircle(center,radius, angle){

    let circle = [],
        x = radius,
        y = 0,
        err = 0,
        octant1 = [],
        octant2 = [],
        octant3 = [],
        octant4 = [],
        octant5 = [],
        octant6 = [],
        octant7 = [],
        octant8 = [];

    while (x >= y) {

        octant1.push([center[0] + x, center[1] + y]);
        octant2.push([center[0] + y, center[1] + x]);
        octant3.push([center[0] - y, center[1] + x]);
        octant4.push([center[0] - x, center[1] + y]);
        octant5.push([center[0] - x, center[1] - y]);
        octant6.push([center[0] - y, center[1] - x]);
        octant7.push([center[0] + y, center[1] - x]);
        octant8.push([center[0] + x, center[1] - y]);

        if (err <= 0) {
            y += 1;
            err += (2*y) + 1;
        } else if (err > 0) { // else if makes this a "thick" circle.  no diagnal connections
            x -= 1;
            err -= (2*x) + 1;
        }
    }

    octant1.shift();
    octant2.reverse().shift();
    octant3.shift();
    octant4.reverse().shift();
    octant5.shift();
    octant6.reverse().shift();
    octant7.shift();
    octant8.reverse().shift();

    return octant1.concat(octant2, octant3, octant4, octant5, octant6, octant7, octant8);

  }

  function slope(point1, point2, raster){
    let h1 = pointToElevation(point1,raster) + raster.subjectHeight;
    let h2 = pointToElevation(point2,raster) + raster.objectHeight;
    return (h2 - h1) / distance(point1,point2);
  }

  // returns [{point:[x,y],bool: true/false},{...}]
  function testLine(line,raster){
    let origin = line[0];
    let highestSlope = -Infinity;
    // let lastWasTrue = true;

    return line.map(p => {
      if (p[0] === origin[0] && p[1] === origin[1]){
        return {
          bool: true,
          point: p
        }
      } else {
        let slopeRes = slope(origin, p, raster);
        if (slopeRes >= highestSlope){
          highestSlope = slopeRes;
          return {
            bool: true,
            point: p
          }
        } else {
          return {
            bool: false,
            point: p
          }
        }
      }
    }).filter((res)=>res.bool===true);
  }

  function flipLine(resultLine,raster){
    resultLine.forEach((result)=>{
      let idx = pointToIndex(result.point, raster.pixelsWidth, raster.pixelsLength);
      if (idx){
        raster.pixels[idx] = true;
      }
    });
  }

  /**
  * Traces outline of result, returns polygon with rings based on that
  * Adapted from potrace tracing algorithm
  *
  */
  function traceResult(raster,smallestArea){
    return new Promise((resolve,reject)=>{
      let currentPoint = [0,0];
      let rings = [];
      let iter = 0;
      while(true){
        currentPoint = findNext(currentPoint,raster);
        if (!currentPoint) break;

        let newRing = findRing(currentPoint,raster);
        flipRing(newRing,raster);
        if (newRing.area > smallestArea){
          newRing.points = ringToMap(newRing.points,raster);
          rings.push(newRing);
        }

      }

      resolve(rings);
    });
  }

  function ringToMap(points,raster){
    return points.map((p)=>pointToLngLat(p,raster));
  }

  function findNext(point,raster){
    let idx = pointToIndex(point,raster.pixelsWidth,raster.pixelsLength);
    while (idx < raster.pixelsLength && raster.pixels[idx] === false){
      idx += 1;
    }
    if (idx >= raster.pixelsLength){
      return null;
    } else {
      return indexToPoint(idx,raster.pixelsWidth);
    }

  }

  function findRing(point,raster){
    let ring = [],
        origin = [point[0],point[1]],
        x = point[0],
        y = point[1],
        dirX = 0,
        dirY = 1,
        xMax = -Infinity,
        yMax = -Infinity,
        xMin = Infinity,
        yMin = Infinity,
        area = 0,
        tmp;

    while (true){
      ring.push([x,y]);

      if (x > xMax){
        xMax = x;
      }
      if (x < xMin){
        xMin = x;
      }
      if (y > yMax){
        yMax = y;
      }
      if (y < yMin){
        yMin = y;
      }

      x += dirX;
      y += dirY;

      area -= x * dirY;

      if (x === origin[0] && y === origin[1]){
        ring.push([x,y]);
        break;
      }

      let l = raster.pixels[pointToIndex([ x + ((dirX + dirY -1) / 2), y + ((dirY - dirX -1) / 2) ],raster.pixelsWidth, raster.pixelsLength)];
      let r = raster.pixels[pointToIndex([ x + (( dirX - dirY - 1) / 2), y + ((dirY + dirX -1) / 2) ],raster.pixelsWidth, raster.pixelsLength)];

      if (r && !l){
        tmp = dirX;
        dirX = dirY;
        dirY = -tmp;
      } else if (r){
        tmp = dirX;
        dirX = -dirY;
        dirY = tmp;
      } else if (!l){
        tmp = dirX;
        dirX = dirY;
        dirY = -tmp;
      }
    }

    return {
      points: ring,
      area: area,
      xMin: xMin,
      yMin: yMin,
      xMax: xMax,
      yMax: yMax 
    }


  }

  function flipRing(ring,raster){
    let x, y, xMax, yMin;
    let y1 = ring.points[0][1];

    ring.points.forEach((p)=>{
      x = p[0];
      y = p[1];
      if (y !== y1){
        yMin = y1 < y ? y1 : y;
        xMax = ring.xMax;
        for (let i = x; i < xMax; i++){
          flipPoint([i,yMin],raster);
        }
        y1 = y;
      }
    });
  }

  function flipPoint(point,raster){
    let idx = pointToIndex(point, raster.pixelsWidth, raster.pixelsLength);
    if (idx){
      raster.pixels[idx] = !raster.pixels[idx];
    }
  }
});
