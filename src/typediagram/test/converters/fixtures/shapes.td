type Point {
  x: Float
  y: Float
}
union Shape {
  Circle {
    radius: Float
    label: String
  }
  Rect {
    w: Float
    h: Float
    corner: Point
  }
  Pair(Int, String)
  Tagged(Point)
  Empty
}
type Canvas {
  name: String
  shape: Shape
  backup: Option<Shape>
}
