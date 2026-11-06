# heightmap grid around the route from AWS terrarium tiles (z15), stored as metres*10 ints
import json,math,io,os,urllib.request,hashlib
from PIL import Image
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d=json.load(open(f"{ROOT}/data/route.json"))
d["cards"]=[c for c in d["cards"] if "murder" not in c["title"].lower()]
lat0,lon0=d["start"]; kx=111320*math.cos(math.radians(lat0)); ky=110540
xs=[p["x"] for p in d["pts"]]; ys=[p["y"] for p in d["pts"]]
M=420; x0,x1=min(xs)-M,max(xs)+M; y0,y1=min(ys)-M,max(ys)+M
step=8; nx=int((x1-x0)/step)+1; ny=int((y1-y0)/step)+1
Z=15; tiles={}
def tile(tx,ty):
    if (tx,ty) not in tiles:
        url=f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png"
        f=f"{ROOT}/data/cache/{hashlib.md5(url.encode()).hexdigest()}"
        if not os.path.exists(f):
            open(f,"wb").write(urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"skate-walk"})).read())
        tiles[(tx,ty)]=Image.open(f).convert("RGB")
    return tiles[(tx,ty)]
def elev(lat,lon):
    n=2**Z; x=(lon+180)/360*n; y=(1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n
    tx,ty=int(x),int(y); p=tile(tx,ty).getpixel((min(255,int((x-tx)*256)),min(255,int((y-ty)*256))))
    return p[0]*256+p[1]+p[2]/256-32768
h=[]
for j in range(ny):
    for i in range(nx):
        X=x0+i*step; Y=y0+j*step
        h.append(int(round(elev(lat0+Y/ky, lon0+X/kx)*10)))
d["terrain"]={"x0":round(x0,1),"y0":round(y0,1),"step":step,"nx":nx,"ny":ny,"h":h}
json.dump(d,open(f"{ROOT}/data/route.json","w"),ensure_ascii=False,separators=(",",":"))
print(nx,ny,min(h)/10,max(h)/10, len(d["cards"]), os.path.getsize(f"{ROOT}/data/route.json"))
import collections; print(collections.Counter(p["hw"] for p in d["pts"]))
