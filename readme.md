I've done work depending on this, and polygon logic is a nightmare in 3D.  It would be far simpler (in my opinion) if CW = fill and CCW = hole, always, no matter what, in all circumstances.

Currently, users must keep track of whether a ring should be a hole or a fill AND must order rings correctly so that "children" rings  come directly after parent rings.

Maybe there's a reason for this that I don't understand, but, from a user perspective, CW = fill CCW = hole is far simpler than what I'm currently dealing with.  I've had to implement a even-odd rule myself and order rings in such a way that a child ring always comes after a parent.