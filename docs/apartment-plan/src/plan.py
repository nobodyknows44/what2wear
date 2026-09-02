# -*- coding: utf-8 -*-
"""Apartment plan reconstructed from the hand measurements (IMG_2445).
X -> east, Y -> south, metres. Origin = inner NW corner of Room 1."""

S  = 92.0              # drawing units per metre
OX, OY = 230.0, 205.0  # page offset

E = 0.30               # exterior wall (drawn)
I = 0.125              # interior wall (measured: 0,125)

# ------------------------------------------------------------------ rooms
ROOM_A = [(0.000,0.000),(2.959,0.000),(2.959,1.318),(2.672,1.318),
          (2.672,1.858),(3.126,1.858),(3.126,7.133),(2.513,7.133),
          (2.513,6.435),(0.000,6.435),(0.000,1.119),(0.908,1.119),
          (0.908,0.559),(0.000,0.559)]

ROOM_B = [(0.401,6.560),(2.256,6.560),(2.256,8.661),
          (0.000,8.661),(0.000,7.134),(0.401,7.134)]

ROOM_C = [(0.000,8.786),(1.860,8.786),(1.860,11.384),
          (0.080,11.384),(0.080,10.851),(0.000,10.851)]

HALL   = [(2.381,7.133),(6.843,7.133),(6.843,9.508),(3.801,9.508),
          (3.801,8.786),(3.126,8.786),(3.126,11.384),(1.985,11.384),
          (1.985,8.786),(2.381,8.786)]

ROOM_D = [(3.126,8.911),(3.676,8.911),(3.676,9.633),(5.795,9.633),
          (5.795,12.713),(3.126,12.713)]

ROOMS = [("A", ROOM_A, "КОМНАТА 1"),
         ("B", ROOM_B, "ПОМЕЩЕНИЕ 2"),
         ("C", ROOM_C, "ПОМЕЩЕНИЕ 3"),
         ("H", HALL,   "КОРИДОР /|ПРИХОЖАЯ"),
         ("D", ROOM_D, "КОМНАТА 4")]

def area(p):
    s = 0.0
    for i in range(len(p)):
        x1,y1 = p[i]; x2,y2 = p[(i+1) % len(p)]
        s += x1*y2 - x2*y1
    return abs(s)/2.0

def centroid(p):
    a = cx = cy = 0.0
    for i in range(len(p)):
        x1,y1 = p[i]; x2,y2 = p[(i+1) % len(p)]
        cr = x1*y2 - x2*y1
        a += cr; cx += (x1+x2)*cr; cy += (y1+y2)*cr
    a *= 0.5
    return cx/(6*a), cy/(6*a)

# ----------------------------------------------- walls: (x, y, w, h) in m
WALLS = [
    # ---------- Room 1 -------------------------------------------------
    (-E,      -E,     2.959+2*E, E     ),  # north  2,959
    (2.959,   -E,     E,         1.618 ),  # east   1,318
    (2.672,   1.318,  0.587,     E     ),  # step   0,287
    (2.672,   1.318,  E,         0.540 ),  # step   0,540
    (2.672,   1.558,  0.454,     E     ),  # step   0,454
    (3.126,   1.558,  E,         5.575 ),  # east   5,275
    (-E,      -E,     E,         0.859 ),  # west   0,559
    (-E,      0.559,  1.208,     0.560 ),  # niche  0,908 x 0,560
    (-E,      1.119,  E,         5.441 ),  # west   5,316
    (-E,      6.435,  2.813,     I     ),  # south  2,513
    (2.381,   6.435,  0.132,     0.698 ),  # step   0,45 + 0,242
    # ---------- Room 2 -------------------------------------------------
    (0.000,   6.560,  0.401,     0.574 ),  # 0,4 x 0,574 block
    (-E,      6.560,  E,         2.226 ),  # west   1,527
    (-E,      8.661,  2.681,     I     ),  # south  2,256
    (2.256,   6.435,  I,         2.351 ),  # east   0,676/0,613/1,051
    # ---------- Room 3 -------------------------------------------------
    (-E,      8.786,  E,         2.065 ),  # west   2,598
    (-E,      10.851, 0.380,     I     ),  # step   0,08
    (-0.220,  10.976, E,         0.408 ),  # west   0,533
    (-0.220,  11.384, 2.205,     E     ),  # south  1,88
    (1.860,   8.661,  I,         3.023 ),  # east
    # ---------- Hall / corridor ----------------------------------------
    (3.126,   6.833,  4.017,     E     ),  # north  2,56 + 1,770
    (6.843,   6.833,  E,         2.975 ),  # east   (вход)
    (5.795,   9.508,  1.348,     E     ),  # south-east exterior
    (1.860,   11.384, 1.566,     E     ),  # south end of the corridor leg
    # ---------- Room 4 -------------------------------------------------
    (3.001,   8.786,  0.675,     I     ),  # north  0,55
    (3.676,   8.786,  I,         0.847 ),  # step   1,3
    (3.801,   9.508,  1.994,     I     ),  # north  0,66 + 1,085
    (3.001,   8.786,  I,         2.598 ),  # west   0,83 / 0,7 / 2,272
    (2.826,   11.384, E,         1.629 ),  # west lower (exterior)
    (5.795,   9.508,  E,         3.505 ),  # east   3,080
    (2.826,   12.713, 3.269,     E     ),  # south  0,435 + 1,82 + 0,4
]

# ---------------- doors -------------------------------------------------
# gap  : rectangle (m) cut out of the wall, or None when the passage is open
# door : draw.io floorplan door: (x_px, y_px, w_px, h_px, direction, kind)
#        the stencil draws a 5px frame band plus a quarter-circle swing.
def _dx(v): return OX + v * S
def _dy(v): return OY + v * S

def _v_door(x_band, y_top, d_m, swing, kind="doorRight"):
    """Door in a vertical wall. x_band = x (m) of the face the frame sits on."""
    D = d_m * S
    if swing == "w":          # opening on the east edge, leaf swings west
        return (_dx(x_band) - (D + 5), _dy(y_top), D + 5, D, "south", kind)
    return (_dx(x_band), _dy(y_top), D + 5, D, "north", kind)   # swings east

def _h_door(x_left, y_band, d_m, swing, kind="doorRight"):
    """Door in a horizontal wall. y_band = y (m) of the face the frame sits on."""
    D = d_m * S
    if swing == "n":          # opening on the south edge, leaf swings north
        return (_dx(x_left), _dy(y_band) - (D + 5), D, D + 5, "west", kind)
    return (_dx(x_left), _dy(y_band), D, D + 5, "east", kind)    # swings south

DOORS = [
    # Комната 1 <-> коридор (проём 0,613, без полотна в стене — открытый проём)
    (None,                          _h_door(2.513, 7.133, 0.613, "n"),          "0,613"),
    # коридор <-> Помещение 2 (0,613, 0,676 от северного края)
    ((2.256, 7.236, I,   0.613),    _v_door(2.381, 7.236, 0.613, "w"),          "0,613"),
    # коридор <-> Комната 4 (0,70, 0,83 от северо-западного угла)
    ((3.001, 9.741, I,   0.700),    _v_door(3.001, 9.741, 0.700, "e"),          "0,70"),
    # коридор <-> Помещение 3
    ((1.860, 8.986, I,   0.700),    _v_door(1.985, 8.986, 0.700, "w"),          "0,70"),
    # входная дверь
    ((6.843, 7.900, E,   0.900),    _v_door(6.843, 7.900, 0.900, "w", "doorLeft"), "ВХОД"),
]
