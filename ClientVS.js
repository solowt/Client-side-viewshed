define('ClientVS', [
	"dojo/_base/declare",
	"esri/geometry/Point",
	"esri/geometry/geometryEngineAsync",
	"esri/geometry/support/webMercatorUtils",
	"esri/geometry/Circle",
	"esri/geometry/Polyline",
	"esri/geometry/Polygon",
],
function (declare, Point, geoEngineAsync, wmUtils, Circle, Polyline, Polygon) {
	return declare(null, {
	    constructor: function(view){
	      if (!view){
	      	throw "Please pass a scene view to the ClientVS constructor.";
	      }
	      this.view = view;
	    },

	    EARTH_DIAM: 12740000, // diameter of earth in meters,

	    /**
	  	* doClientVS - call this to do a viewshed
	  	  @param: {options} - contains the following properties:
	  	* 	{esriPoint} - inputGeometry - observer's location, the center of the viewshed
		* 	{number} - radius - radius of viewshed in meters
		*   {number} - pixelWidth - width/height of pixel in meters, determines resolution of viewshed. lower is more accurate but slower
		* 	{number} - observerHeight - height of observer above terrain in meters
		*   {number} - objectHeight - height of thing being observed in meters
		*
		* @returns {Promise} -> resolves to a polygon geometry
		*/
		doClientVS(options){
		    return new Promise((fulfill, reject) => {

		    	// defaults
		  	    let point = options.inputGeometry.spatialReference.isWGS84 ? wmUtils.geographicToWebMercator(options.inputGeometry) : options.inputGeometry,
			        radius = options.radius || 5000,
			        resolution = options.pixelWidth || 20,
			        subjectHeight = options.observerHeight || 2,
			        objectHeight = options.objectHeight || 0;

			    // create a circle based on radius and center
			    let circle = this.buildCircle([point.longitude, point.latitude], radius);
			    
			    // create the bounds.  you can think of this as the x axis, y axis, top, and bottom of the raster
			    // these are just polylines densified by the input resolution
			    this.buildBounds(circle, resolution).then(bounds => {
			    	let xAxis = bounds.x.paths[0];
			        let yAxis = bounds.y.paths[0];
			        let top = bounds.top.paths[0];
			        let right = bounds.right.paths[0];

			        // this will hold all the elevation values
			        let elevationRaster = new Array(xAxis.length * yAxis.length).fill(null);

			        let raster = {
			            view: this.view,
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
			            objectHeight: objectHeight, 
			            resolution: resolution
			        }

			        // fetch all the needed elevations from the basemapTerrain
			        elevationRaster = elevationRaster.map((cell, index) => {
			        	let point = this.indexToPoint(index, raster.pixelsWidth); // the point whose elevation is being fetched
			        	let distance = this.distance(point, raster.pixelsCenter); // distance to observer in raster space
					    let geoPoint = this.indexToGeoPoint(index, raster); // map space point for the point

			        	// if index being checked is raster center
			        	if (distance === 0){
			        		// just get elevation + observer height.  store on raster because we need to calculate this a lot
			        		raster.centerElevation = this.view.basemapTerrain.getElevation(wmUtils.webMercatorToGeographic(geoPoint)) + raster.subjectHeight;
			        		return raster.centerElevation;
			        	} else {
			        		// get elevation + observed height with earth's curve accounted for
					        return this.geoPointToElevation(wmUtils.webMercatorToGeographic(geoPoint), this.view, distance, raster);
			        	}
			        });

			        raster.elevationRaster = elevationRaster;

			        // now that we have the raster filled in, do the actual computation
			        this.computeViewshed(raster).then(result => {
			          	
			          	// the rings are returned by the computation
			        	let rings = result.map((r)=>r.points);

			        	// fulfill the polygon geometry
			        	fulfill(new Polygon({
			            	rings: rings,
			            	spatialReference: { wkid: 3857 }
		            	}));

			        });
			    });
		    });

		},

		// return a geodesic circle given an extent and radius
		buildCircle: function(center, radius){
		    return new Circle({
		    	center: center,
		    	radius: radius,
		    	radiusUnit: 'meters',
		    	geodesic: true
		    });
		},

		// get the X, Y, top, and bottom polylines.
		// these are just the edges of the circle's extent densified at the user input resolution
		buildBounds: function(circle, resolution){
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
		      	})).then(results => {
		    		let resultsDict = results.reduce((accum, curr) => {
		    			accum[curr.name] = curr.line;
		    			return accum;
		    		},{});

		    		resolve(resultsDict);
		    	});
		    });
		},
		
		// do the actual computation
		computeViewshed: function(raster){
		    let circleRadius = Math.min(raster.pixelsCenter[0],raster.pixelsCenter[1]) - 1;

		    // rasterize a circle.  we have the circle in map space, but we need it in raster space
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

		    	// once the raster is complete, we need to trace the edges of the visibile areas to get the rings
		    	// of the resulting polygon
		      	this.traceResult(raster, 0).then((rings)=>{
		        	resolve(rings);
		      	});
		    });
		},

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

        earthCurveOffset(resolution, distance, baseElevation){
			return baseElevation - (.87 * (Math.pow((distance * resolution), 2) / this.EARTH_DIAM));
  		},
		
		// count up result pixels to see how many can be seen and how many can't.
		// this is just a testing method
		countPixels: function(pixels){
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
  		},

  		// go from raster space [x,y] to array space. remember the raster is a 1D array
  		pointToIndex: function(point,width,length){
		    let idx = point[1] * width + point[0];
		    
		    if (idx < length && idx >= 0){
		    	return idx;
		    } else {
		    	return null
		    }
		},

		// go from array space to raster space [x,y] 
		indexToPoint: function(idx,width){
		    const x = idx % width;
		    const y = (idx - x) / width;
		    return([x,y]);
		},

		// go from array space to map space
  		indexToGeoPoint: function(idx,raster){
		    let point = this.indexToPoint(idx,raster.pixelsWidth);
		    return this.pointToGeoPoint(point,raster);
  		},

  		// go from raster space to map space
  		pointToGeoPoint: function(point,raster){
    		return new Point({
		      	longitude: raster.xAxis[point[0]][0],
		      	latitude: raster.yAxis[point[1]][1],
		      	spatialReference: { wkid: 4326 }
		    });
  		},

  		// given an [x,y] point, return a [lng,lat] (map space)
  		pointToLngLat: function(point,raster){
    		return [
			    raster.xAxis[point[0]][0],
			    raster.yAxis[point[1]][1]
    		]
  		},

  		// given a point, the distance (in raster space) and some other stuff, return an elevation.
  		// this takes the earth's curvature into account.
  		geoPointToElevation: function(point, view, distance, raster){
		    let baseElevation = view.basemapTerrain.getElevation(point) + raster.objectHeight;
		    let realElevation = this.earthCurveOffset(raster.resolution, distance, baseElevation);

		    return realElevation;
  		},

  		// does a look up in the already-built elevation raster
  		pointToElevation: function(point,raster){
		    let idx = this.pointToIndex(point, raster.pixelsWidth, raster.pixelsLength);
		    return raster.elevationRaster[idx];
		    // let geoPoint = pointToGeoPoint(point,raster);
		    // return geoPointToElevation(geoPoint,raster.view);
		},

		// disrance formula for raster
		distance: function(point1,point2){
    		return Math.sqrt( (Math.pow(point2[0] - point1[0], 2)) + (Math.pow(point2[1] - point1[1], 2)) );
  		},

		// bresenham line rasterization algorithm
		drawLine: function(point1, point2){
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
  		},

		// draw a circle given a center and radius in raster space
		// keep octants separate so this will be in a continuous order
		drawCircle: function(center,radius, angle){
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

	  	},

	  	// slope formula
  		slope: function(point1, point2, raster){
		    let h1 = raster.centerElevation;
		    let h2 = this.pointToElevation(point2,raster);
		    return (h2 - h1) / this.distance(point1,point2);
  		},

  		// returns [{point:[x,y],bool: true/false},{...}]
  		testLine: function(line,raster){
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
		},

  		flipLine: function(resultLine,raster){
		    resultLine.forEach((result)=>{
		    	let idx = this.pointToIndex(result.point, raster.pixelsWidth, raster.pixelsLength);
		    	if (idx){
		        	raster.pixels[idx] = true;
		      	}
		    });
  		},

		/**
		* Traces outline of result, returns polygon with rings based on that
		* Adapted from potrace tracing algorithm
		*
		*/
		traceResult: function(raster, smallestArea){
		    return new Promise((resolve,reject)=>{
		    	let currentPoint = [0,0];
		      	let rings = [];
		      	let iter = 0;
		      	
		      	while(true){
		        	currentPoint = this.findNext(currentPoint,raster);
		        	if (!currentPoint) break;

		        	let newRing = this.findRing(currentPoint, raster, rings.length);
		        	this.flipRing(newRing, raster);
		        	if (newRing.area > smallestArea){
		        		// newRing.points = this.ringToMap(newRing.points,raster)
		          		rings.push(newRing);
		        	}
		        }
		        
		        // reverse rings that are inside and count "children" rings that each ring contains
		        this.evenOddCheck(rings);
		        
		        // sort array again by children, parents must come before children or
		        // array will not be drawn properly
		        let parents = rings.filter(ring => ring.parents.length === 0 && ring.children.length > 0);
		        let resultRings = []

		        parents.forEach(p => resultRings = resultRings.concat(this.getChildren(p, rings)));
		        // resultRings.shift(); //remove fake node, which is first and has id of null
		        resultRings = resultRings.concat(rings.filter(ring => ring.parents.length === 0 && ring.children.length === 0));
		        
		      	resultRings.forEach(ring => ring.points = this.ringToMap(ring.points,raster));
		    	resolve(resultRings);
		    });
		},

		insertArrayAt(array, index, arrayToInsert) {
    		Array.prototype.splice.apply(array, [index, 0].concat(arrayToInsert));
		},

		/**
		* getChildren - simple BFS
		*
		* @param {ring} ring that has children
		* @param {rings} array of all rings
		*
		* this method orders all the rings that are children of the passed in ring.
		* assuming ring (1) has 3 children (2,3,4) and child 3 has 2 children (5,6)
		* this will return [ring 1, ring 2, ring 3, ring 5, ring 6, ring 4]
		*
		* this is necessary because of unpolished polygon drawing rules in 3D the JS API 
		*/

		getChildren(ring, rings){
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
		},

		/** 
		* evenOddCheck - simple implementation of the even-odd rule: https://en.wikipedia.org/wiki/Even%E2%80%93odd_rule
		*
		* the basic idea is that if you draw a line starting at the edge of each ring in any direction
		* the number of times it crosses other rings tells us whether the polygon should be a hole or a 
		* fill.  if it crosses an even number of times, it's filled, odd number, a hole
		*
		* this method also attaches parent and child arrays to each ring
		* 
		* @param {rings} - all rings
		* @param {raster} - all data
		*/

		evenOddCheck: function(rings){
			rings.forEach((ring,idx) => {
				let intersections = 0; // total intersections with other rings

				// map ring id (array index) to specific intersections with that ring
				let intersectionMap = new Array(rings.length).fill(0);
				
				// start at the x min on each ring and decrement until it hits 0
				let x = ring.xMin;
				let y = ring.yAtXmin;
				
				while (x > 0){
					for (let j = 0; j < rings.length; j++){
						if (j !== idx && // first condition: we don't care about this ring intersecting itself
							(x >= rings[j].xMin && // second condition: this is a test to make sure that the point is inside
							x <= rings[j].xMax &&  // the bounding box of the ring being checked.  if it is not inside, there 
							y >= rings[j].yMin &&  // cannot be an intersection so we don't need to test it.  this saves us some testing
							y <= rings[j].yMax)) {

							let points = rings[j].points;
							let l = points.length - 1; // check the current point in the ring against the previous to see if it crossed the ring

							for (let k = 0; k < points.length; k++){
								if (((points[k][1] > y) !== (points[l][1] > y)) &&
									((points[k][0] === x) || (points[l][0] === x))){
									
									intersections += 1;
									intersectionMap[rings[j].id] += 1;
								}
								l = k;
							}
						}
					}
					x--;
					
				}

				// map of ring id (idx) to bool: does that ring contain this ring?
				// we need this to determine ring order.  if the ring being checked is
				// contained by each ring, push this ring's id (idx) onto that ring's children array
				intersectionMap.forEach((intersectionCount,index) => {
					if (intersectionCount % 2 !== 0){
						ring.parents.push(index);
						rings[index].children.push(idx)
					}
				});

				// if total intersections is not even, reverse ring so it will be ccw 
				if (intersections % 2 !== 0){
					ring.points.reverse();
				}
			});
		},

		// translate rings of [x,y] (raster) into rings of [lng,lat] (map)
  		ringToMap: function(points,raster){
    		return points.map((p)=> this.pointToLngLat(p,raster));
  		},

  		// find next true/false border for ring tracing
  		findNext: function(point,raster){
    		let idx = this.pointToIndex(point,raster.pixelsWidth,raster.pixelsLength);
    		while (idx < raster.pixelsLength && raster.pixels[idx] === false){
        		idx += 1;
    		}
    
    		if (idx >= raster.pixelsLength){
      			return null;
    		} else {
      			return this.indexToPoint(idx,raster.pixelsWidth);
    		}

  		},	

  		// find the next ring
	  	findRing: function(point,raster, id){
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
			    id: id, // idx of ring, used to key this ring when it gets re-ordered later
		    	points: ring,
			    area: area,
			    xMin: xMin,
			    yAtXmin: yAtXmin, // used for even-odd check
			    yMin: yMin,
			    xMax: xMax,
			    yMax: yMax,
			    children: [], // used later
			    parents: [] // used later
		    };
		},

		// flip ring to be all falses
  		flipRing: function(ring,raster){
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
  		},

  		// flip a point from true to false
  		flipPoint: function(point,raster){
		    let idx = this.pointToIndex(point, raster.pixelsWidth, raster.pixelsLength);
		    if (idx){
      			raster.pixels[idx] = !raster.pixels[idx];
    		}
  		}
  	});   
});