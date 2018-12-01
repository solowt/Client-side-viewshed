const EARTH_DIAM = 12740000;

define([
  "esri/geometry/Point",
  "esri/geometry/geometryEngine",
  "esri/geometry/support/webMercatorUtils",
  "esri/geometry/Circle",
  "esri/geometry/Polyline",
  "esri/geometry/Polygon",
  "esri/geometry/Multipoint",
  "esri/layers/ElevationLayer"
],
function (Point, geoEngine, wmUtils, Circle, Polyline, Polygon, Multipoint, ElevationLayer) {
  var ClientVS = function ClientVS(url) {
    this.elevationServiceUrl = url || "//elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer";
  }

 /**
  * doClientVS - call this to do a viewshed
  *  @param: {options} - contains the following properties:
  *   {esriPoint} - inputGeometry - observer's location, the center of the viewshed
  *   {number} - radius - radius of viewshed in meters
  *   {number} - pixelWidth - width/height of pixel in meters, determines resolution of viewshed. lower is more accurate but slower
  *   {number} - observerHeight - height of observer above terrain in meters
  *
  * @returns {Promise} -> resolves to a polygon geometry
  */
  ClientVS.prototype.doClientVS = function(options){
    // defaults
    let point = options.inputGeometry.spatialReference.isWGS84 ? options.inputGeometry : wmUtils.webMercatorToGeographic(options.inputGeometry),
      radius = options.radius || 2000,
      resolution = options.pixelWidth || 20,
      subjectHeight = options.observerHeight;

    let circle = this.buildCircle([point.x, point.y], radius);

    return this.buildBounds(circle, resolution).then(bounds => {
      let xAxis = bounds.x.paths[0];
      let yAxis = bounds.y.paths[0];
      let top = bounds.top.paths[0];
      let right = bounds.right.paths[0];
      
      // this will hold all the elevation values
      let elevationRaster = new Array(xAxis.length * yAxis.length).fill(null);
      let raster = {
        pixels: new Array(xAxis.length * yAxis.length).fill(false), // visibility raster, start everything as false
        circle: circle,
        xAxis: xAxis,
        yAxis: yAxis,
        top: top,
        right: right,
        pixelsLength: xAxis.length * yAxis.length, // total number of pixels
        pixelsWidth: xAxis.length, // width of raster
        pixelsCenter: [Math.floor(xAxis.length/2),Math.floor(yAxis.length/2)], // center of pixels in [X,Y] form
        geoPointCenter: [xAxis[Math.floor(xAxis.length/2)][0],yAxis[Math.floor(yAxis.length/2)][1]], // center of pixels in map space
        subjectHeight: subjectHeight,
        resolution: resolution
      }

      raster.centerIndex = this.pointToIndex(raster.pixelsCenter, raster.pixelsWidth, raster.pixelsLength);

      // fetch all the needed elevations from the sampler
      return new ElevationLayer({ url: this.elevationServiceUrl })
        .createElevationSampler(circle.extent, {
          demResolution: "finest-contiguous"
        })
        .then(sampler => {
          const points = elevationRaster.map((cell, index) => {
            return this.indexToXY(index, raster);
          });

          let multipoint = new Multipoint({
            points,
            spatialReference: { wkid: 3857 }
          });

          multipoint = sampler.queryElevation(multipoint);

          raster.elevationRaster = multipoint.points.map((point, index) => {
            if (index === raster.centerIndex) {
              const elevationAtCenter = point[2] + raster.subjectHeight;
              raster.centerElevation = elevationAtCenter;
            }

            // take earth's curvature into account
            const rasterPoint = this.indexToPoint(index, raster.pixelsWidth);
            const real = this.earthCurveOffset(raster.resolution, this.distance(rasterPoint, raster.pixelsCenter), point[2]);
            return real;
          });

          return this.computeViewshed(raster).then(rings => {

            return new Polygon({
              rings: rings,
              spatialReference: { wkid: 3857 }
            }).toJSON();
          });
        })
    });
  }

  // return a geodesic circle given an extent and radius
  ClientVS.prototype.buildCircle = function(center, radius){
    return new Circle({
      center: center,
      radius: radius,
      radiusUnit: 'meters',
      geodesic: true,
    });
  }

  // get the X, Y, top, and bottom polylines.
  // these are just the edges of the circle's extent densified at the user input resolution
  ClientVS.prototype.buildBounds = function(circle, resolution){
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

      let results = lineArray.map(line => {
        let wmLine = wmUtils.geographicToWebMercator(line.line);
        let densifiedLine = geoEngine.densify(wmLine, resolution, "meters");
        return {
          name: line.name,
          line: densifiedLine
        };
      });

      let resultsDict = results.reduce((accum, curr) => {
        accum[curr.name] = curr.line;
        return accum;
      }, {});

      resolve(resultsDict);
    });
  }
    
  ClientVS.prototype.computeViewshed = function(raster){
    let circleRadius = Math.min(raster.pixelsCenter[0],raster.pixelsCenter[1]) - 1;

    // rasterize a circle.  have the circle in map space, but we need it in raster space
    let circle = this.drawCircle(raster.pixelsCenter, circleRadius);


    // for each raster [x,y] point in the circle, do a line check
    // this involves checking the line from the center of the circle to the edge and 
    // walking along it
    return new Promise((resolve,reject)=>{
      circle.forEach((point)=>{
        let line = this.drawLine(raster.pixelsCenter,point);
        let resultLine = this.testLine(line,raster);
        this.flipLine(resultLine,raster); // for pixels in the line that can be seen, change them to true
      });

      raster.resultRaster = raster.pixels.slice();

      // once the raster is complete, we need to trace the edges of the visibile areas to get the rings
      // of the resulting polygon
      this.traceResult(raster, 0).then((rings)=>{
        resolve(rings);
      });
    });
  }

  /**
    * earthCurvOffset
    * given elevation at a point, distance in raster space, and resolution (width/height of raster cell)
    * return the correct offset based on the earth's elevation
    *
    * @param {number} - resolution -width of raster cell in meters
    * @param {number} - distance - distance between observer and point in raster units  
    * @param {number} - baseElevation - the elevation of the prior to this correction
    *
    * @returns {number} - correct elevation of the point
    */
  ClientVS.prototype.earthCurveOffset = function(resolution, distance, baseElevation){
    let r = baseElevation - (.87 * (Math.pow((distance * resolution), 2) / EARTH_DIAM));
    return r;
  }
    
  // count up result pixels to see how many can be seen and how many can't.
  // this is just a testing method
  ClientVS.prototype.countPixels = function(pixels){
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

    // go from raster space [x,y] to array space. remember the raster is a 1D array
  ClientVS.prototype.pointToIndex = function(point,width,length){
    let idx = point[1] * width + point[0];
      
    if (idx < length && idx >= 0){
      return idx;
    } else {
      return null
    }
  }

  // go from array space to raster space [x,y] 
  ClientVS.prototype.indexToPoint = function(idx,width){
    const x = idx % width;
    const y = (idx - x) / width;
    return([x,y]);
  }

  // go from array space to map space
  ClientVS.prototype.indexToGeoPoint = function(idx,raster){
    let point = this.indexToPoint(idx,raster.pixelsWidth);
    return this.pointToGeoPoint(point,raster);
  }

  ClientVS.prototype.indexToXY = function(idx, raster) {
    let point = this.indexToPoint(idx,raster.pixelsWidth);
    return [
      raster.xAxis[point[0]][0],
      raster.yAxis[point[1]][1]
    ];
  }

      // go from raster space to map space
  ClientVS.prototype.pointToGeoPoint = function(point,raster){
    return new Point({
      longitude: raster.xAxis[point[0]][0],
      latitude: raster.yAxis[point[1]][1],
      spatialReference: { wkid: 4326 }
    });
  }

  // given an [x,y] point, return a [lng,lat] (map space)
  ClientVS.prototype.pointToLngLat = function(point,raster){
    if (raster.xAxis[point[0]] && raster.xAxis[point[1]]){
      return [
        raster.xAxis[point[0]][0],
        raster.yAxis[point[1]][1]
      ]
    } else {
      return null;
    }
  }

  // given a point, the distance (in raster space) and some other stuff, return an elevation.
  // this takes the earth's curvature into account.
  ClientVS.prototype.geoPointToElevation = function(point, view, distance, resolution, sampler){
    let baseElevation = sampler.queryElevation(point);
    return baseElevation.z;
  }

  // does a look up in the already-built elevation raster
  ClientVS.prototype.pointToElevation = function(point,raster){
    let idx = this.pointToIndex(point, raster.pixelsWidth, raster.pixelsLength);
    return raster.elevationRaster[idx];
  }

  // disrance formula for raster
  ClientVS.prototype.distance = function(point1,point2){
    return Math.sqrt( (Math.pow(point2[0] - point1[0], 2)) + (Math.pow(point2[1] - point1[1], 2)) );
  }

  // bresenham line rasterization algorithm
  ClientVS.prototype.drawLine = function(point1, point2){
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
  // keep octants separate so this will be in a continuous order
  ClientVS.prototype.drawCircle = function(center,radius, angle){
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

  ClientVS.prototype.slope = function(point1, point2, raster){
    let h1 = raster.centerElevation;
    let h2 = this.pointToElevation(point2,raster);
    return (h2 - h1) / this.distance(point1,point2);
  }

  // returns [{point:[x,y],bool: true/false},{...}]
  ClientVS.prototype.testLine = function(line,raster){
    let origin = line[0];
    let highestSlope = -Infinity;

    return line.map(p => {
      if (p[0] === origin[0] && p[1] === origin[1]){
        return {
          bool: true,
          point: p
        }
      } else {
        let slopeRes = this.slope(origin, p, raster);
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

  ClientVS.prototype.flipLine = function(resultLine,raster){
    resultLine.forEach((result)=>{
      let idx = this.pointToIndex(result.point, raster.pixelsWidth, raster.pixelsLength);
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
  ClientVS.prototype.traceResult = function(raster, smallestArea){
    return new Promise((resolve,reject) => {
      let currentPoint = [0,0];
      let rings = [];
      let iter = 0;

      while(true){
        currentPoint = this.findNext(currentPoint,raster);
        if (!currentPoint) break;
        let newRing = this.findRing(currentPoint, raster, rings.length);
        this.flipRing(newRing, raster);
        if (newRing.area > smallestArea){
          for (let i = rings.length - 1; i >= 0; i--) {
            const ring = rings[i];
            let inside = this.pointInPolygon([newRing.xMin, newRing.yAtXmin], ring.points);
            if (inside) {
              ring.children.push(newRing.id);
              newRing.parent = ring.id;
              break;
            }
          }
          rings.push(newRing);
        }
      }

      const parents = rings.filter(ring => ring.parent === null && ring.children.length > 0);
      let resultRings = [];
      parents.forEach(p => resultRings = resultRings.concat(this.getChildren(p, rings)));
      resultRings = resultRings.concat(rings.filter(ring => ring.parent === null && ring.children.length === 0));
      resultRings.forEach(ring => ring.points = this.ringToMap(ring.points,raster));
      
      resolve(resultRings.map(ring => ring.points));
    });
  }

  ClientVS.prototype.insertArrayAt = function(array, index, arrayToInsert) {
    Array.prototype.splice.apply(array, [index, 0].concat(arrayToInsert));
  }

/**
  * getChildren - BFS
  *
  * @param {ring} ring that has children
  * @param {rings} array of all rings
  *
  * this method orders all the rings that are children of the passed in ring.
  * assuming ring (1) has 3 children (2,3,4) and child 3 has 2 children (5,6)
  * this will return [ring 1, ring 2, ring 3, ring 5, ring 6, ring 4]
  *
  * complex polygon rings need to be ordered this way to be drawn correctly 
  */
  ClientVS.prototype.getChildren = function(ring, rings){
    let retArray = [ring];
    let queue = [ring];
    while (queue.length > 0){
      curr = queue.shift();
      curr.children.forEach(childIdx => {
        let child = rings.find(ring => ring.id === childIdx);
        if (!retArray.find(aRing => aRing.id === child.id)){
          retArray.push(child);
          queue.push(child);
        }
      });
    }
    return retArray;
  }

  // https://en.wikipedia.org/wiki/Even%E2%80%93odd_rule
  ClientVS.prototype.pointInPolygon = function(point, polygon) {
    const [x, y] = point;
    let ret = false;
    let j = polygon.length - 1;
    for (let i = 0; i < polygon.length; i++) {
      if (((polygon[i][1] > y) !== (polygon[j][1] > y)) &&
          (x < polygon[i][0] + (polygon[j][0] - polygon[i][0]) * (y - polygon[i][1]) / (polygon[j][1] - polygon[i][1]))) {
        ret = !ret;
      }
      j = i;
    }
    return ret;
  }

  // translate rings of [x,y] (raster) into rings of [lng,lat] (map)
  ClientVS.prototype.ringToMap = function(points,raster){
    return points.map((p)=> this.pointToLngLat(p,raster)).filter(point => point);
  }

  // find next true/false border for ring tracing
  ClientVS.prototype.findNext = function(point,raster){
    let idx = this.pointToIndex(point,raster.pixelsWidth,raster.pixelsLength);
    while (idx < raster.pixelsLength && raster.pixels[idx] === false){
        idx += 1;
    }

    if (idx >= raster.pixelsLength){
      return null;
    } else {
      return this.indexToPoint(idx,raster.pixelsWidth);
    }

  }

  // find the next ring
  ClientVS.prototype.findRing = function(point,raster, id){
    let ring = [],
      origin = [point[0],point[1]],
      x = point[0],
      y = point[1],
      dirX = 0,
      dirY = 1,
      xMax = -Infinity,
      yMax = -Infinity,
      xMin = Infinity,
      yAtXmin = null,
      yMin = Infinity,
      area = 0,
      tmp;

    const index = this.pointToIndex([x, y], raster.pixelsWidth, raster.pixelsLength);
    const sign = raster.resultRaster[index];

    while (true){
      ring.push([x,y]);

      if (x > xMax){
        xMax = x;
      }
      if (x < xMin){
        xMin = x;
        yAtXmin = y
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

      let l = raster.pixels[this.pointToIndex([ x + ((dirX + dirY -1) / 2), y + ((dirY - dirX -1) / 2) ],raster.pixelsWidth, raster.pixelsLength)];
      let r = raster.pixels[this.pointToIndex([ x + (( dirX - dirY - 1) / 2), y + ((dirY + dirX -1) / 2) ],raster.pixelsWidth, raster.pixelsLength)];

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
      id: id,
      points: !sign ? ring.reverse() : ring, // reverse rings that should be holes
      area: area,
      xMin: xMin,
      yAtXmin: yAtXmin, // used for even-odd check
      yMin: yMin,
      xMax: xMax,
      yMax: yMax,
      children: [], // used later
      parent: null // used later
    };
  }

  // flip ring to be all falses
  ClientVS.prototype.flipRing = function(ring,raster){
    let x, y, xMax, yMin;
    let y1 = ring.points[0][1];

    ring.points.forEach((p)=>{
      x = p[0];
      y = p[1];
      if (y !== y1){
        yMin = y1 < y ? y1 : y;
        xMax = ring.xMax;
        for (let i = x; i < xMax; i++){
          this.flipPoint([i,yMin],raster);
        }
        y1 = y;
      }
    });
  }

  // flip a point from true to false
  ClientVS.prototype.flipPoint = function(point,raster){
    let idx = this.pointToIndex(point, raster.pixelsWidth, raster.pixelsLength);
    if (idx){
      raster.pixels[idx] = !raster.pixels[idx];
    }
  }
  return ClientVS;
});