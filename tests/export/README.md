# Export verification

Run `npx vitest run tests/export` for the local automated checks. These use Three.js's independent STL and 3MF readers, XML/archive inspection, geometric volume and bounds checks, and fail-closed malformed-body cases. No browser is launched; jsdom supplies only XML parsing for the 3MF reader.

All formats convert the model's inch coordinates to millimeters. STL has no unit metadata, so consumers must interpret it as millimeters. 3MF returns a binary OPC ZIP package. STEP writes AP203 faceted B-Rep with planar polygon boundaries and holes; it does not convert the source model into triangular primary geometry.

## Independent STEP validation

The optional OpenCascade check is separate from the JavaScript suite and does not add a production dependency. PowerShell example using temporary directories:

```powershell
python -m pip install --target "$env:TEMP\modelling-step-reader" cadquery-ocp-novtk==7.9.3.1.1
npx tsx tests/export/generateStepFixtures.mjs "$env:TEMP\modelling-step-fixtures"
python tests/export/validate_step.py "$env:TEMP\modelling-step-fixtures" "$env:TEMP\modelling-step-reader"
```

Alternatively install the reader in a dedicated Python virtual environment and omit the final package-directory argument. Fixture generation only writes into the explicitly supplied directory.

The validator reads the generated files through OpenCascade, checks `BRepCheck_Analyzer`, counts solids, and compares volume and bounds in millimeters. The five fixtures cover a box, concave extrusion, through-hole, rotated solid, and two separate solids. They all passed OpenCascade 7.9.3 during the November 16 audit fixes. This verifies those planar cases; it does not establish compatibility with every CAD application, schema variant, or arbitrary invalid input. No GUI, external platform, or physical manufacturing process was tested.

Export rejects invalid shells, incomplete triangulation, inconsistent winding, zero-volume geometry, and unused vertices rather than writing a partial solid. The same shared export validation is used by all three formats.
