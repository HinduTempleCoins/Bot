# Skulls → faces, skeletons → bodies: free tools and sources

What runs now: **`skullfaces.py`** on the CPU worker, using our own diffusion API (SD + canny ControlNet).
The skull or skeleton photo is the ControlNet structure at a moderate scale (0.45 for faces, 0.35 for bodies),
and every find gets **4–6 different guesses** (skin, hair, age, sex where the find allows) on a contact sheet.
The bone gives the outline; the rest is guesswork, and each sheet says so. No paid APIs. No LoRA training
(that needs operator approval).

Free and open options surveyed for the next step (a true tissue-depth build):
- **OrtogOnBlender / the Cícero Moraes forensic facial approximation workflow** (Blender add-on, GPL). It
  places soft-tissue-depth markers on a 3D skull and sculpts over them. It needs a 3D mesh of the skull.
- **Soft-tissue depth tables** (published): the Manchester method (Wilkinson), and De Greef et al. 2006 for
  Europeans. Use them with the markers above.
- **3D skull scans**: Smithsonian 3D (many CC0), MorphoSource and Sketchfab (CC BY per item; check each), and
  africanfossils.org.
- **2D sources** (used now): Wikimedia Commons, open licences only (PD, CC0, CC BY, CC BY-SA). The licence and
  author are recorded per image in the gallery credit.

Rules: no Native American ancestral remains. The Denisovan is labelled speculative, since no skeleton is known.
H. luzonensis is too little known to reconstruct.
