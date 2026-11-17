"""Independent CLI readback: python validate_step.py <fixtures-dir> [OCP-package-dir].

Install cadquery-ocp-novtk in an isolated environment; it is not an app dependency.
The generator and this validator require no browser or GUI.
"""
import json
import math
from pathlib import Path
import sys

if len(sys.argv) > 2:
    sys.path.insert(0, sys.argv[2])

from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer

directory = Path(sys.argv[1])
for fixture in json.loads((directory / "manifest.json").read_text()):
    reader = STEPControl_Reader()
    assert reader.ReadFile(str(directory / fixture["filename"])) == IFSelect_RetDone
    assert reader.TransferRoots() > 0, fixture["filename"]
    shape = reader.OneShape()
    assert not shape.IsNull(), fixture["filename"]
    assert BRepCheck_Analyzer(shape).IsValid(), f"Invalid BRep: {fixture['filename']}"
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    assert math.isclose(props.Mass(), fixture["volume"], rel_tol=1e-7), (fixture["filename"], props.Mass(), fixture["volume"])
    bounds = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, bounds, False, False)
    assert all(math.isclose(a, b, abs_tol=1e-5) for a, b in zip(bounds.Get(), fixture["bounds"])), (bounds.Get(), fixture["bounds"])
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    solids = 0
    while explorer.More():
        solids += 1
        explorer.Next()
    assert solids == fixture["solids"], (fixture["filename"], solids)
    print(json.dumps({"file": fixture["filename"], "valid": True, "solids": solids, "volume_mm3": props.Mass(), "bounds_mm": bounds.Get()}))
