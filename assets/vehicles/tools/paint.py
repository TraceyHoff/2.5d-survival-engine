import json,sys
VEH=["#c8362f","#e8833a","#f2c94c","#5fae4e","#2f8f83","#3d7fd0","#2c4a8a","#8b5bb5","#e7e2d6","#4a4e57","#7a5236","#d96c9a"]
BIKE=["#e0433a","#f39a2b","#f7d23e","#69c152","#38b5c4","#4f7fe0","#9b62d1","#f27fb2","#f2efe6","#3b3f48"]
json.dump({"vehicle_paint":VEH,"bike_paint":BIKE},open(sys.argv[1]+"/_paint.json","w"))
