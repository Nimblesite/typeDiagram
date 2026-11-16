public record User(string Name, string Email, Address Address);

public record Address(string Line1, string City, string Country);

public enum Shape {
    Circle,
    Square,
    Triangle
}
