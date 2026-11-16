type Point {
  x: Float
  y: Float
}
union Shape {
  Circle {
    radius: Float
    label: String
  }
  Pair(Int, String)
  Tagged(Point)
  Empty
}
type Canvas {
  name: String
  isPinned: Bool
  shape: Shape
  backup: Option<Shape>
}
