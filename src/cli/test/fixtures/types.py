from __future__ import annotations
from dataclasses import dataclass
from enum import Enum

@dataclass
class User:
    name: str
    email: str
    address: Address

@dataclass
class Address:
    line1: str
    city: str
    country: str

class Shape(str, Enum):
    Circle = "circle"
    Square = "square"
    Triangle = "triangle"
