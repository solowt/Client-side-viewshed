# A client-side viewshed implementation using the Esri JavaScript API (https://developers.arcgis.com/javascript/)

## Why?

I wanted to implement this kind of thing in order to gain a better understanding of how it works.

I was curious if this was possible and how fast/slow it would be.  Generally this kind of calculation is done on the back-end, because that's where the elevation data is.  However, if you are using a [3D scene](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-SceneView.html) with an elevation layer added to it, your browser has a lot of elevation data that it uses to render the terrain.

Note: you can use Esri's world elevation layer for free by setting the `ground` property of the map to `'world-elevation'`.  See: https://developers.arcgis.com/javascript/latest/api-reference/esri-Map.html#ground

The takaway here is that this tool will only work if you are using a scene view with elevation added to it.

## Challenges

Since elevation data is organized into tiles, in order to directly use the data from those arrays, you would need to stitch multiple tiles together into a single raster.  I wasn't sure how best to do this, so I didn't.  Instead, I created my own simple raster and filed it by doing lookups in the underlying tiles.  This data is bilinearly interpolated, and the resultion is surprisingly high.

For example, here is a high resolution tile rendered as a black and white png: /home/thomas/Rust/viewshed/test1.png

  If I wanted to speed up this calculation, one option would be figuring out how to stitch the elevation rasters together and offloading the computation to the GPU.



https://jsbin.com/nacowuxome/edit?html,output