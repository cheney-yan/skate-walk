import json,re,os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d=json.load(open(f"{ROOT}/data/route.json"))
BAD=re.compile(r"toyota|interior|sticker|bikini|NZ7|kluger|woman|man |girl|boy|shooting|nude|topless",re.I)
cards=[c for c in d["cards"] if not BAD.search(c["title"]+" "+(c.get("text") or ""))]
for c in cards:
    c["title"]=re.sub(r"\s*\(\d{8,}\)|\s*-\s*panoramio.*$|\s*\(Unsplash[^)]*\)","",c["title"]).strip() or c["title"]
keep=[];last={}
for c in sorted(cards,key=lambda c:(not c["rare"],c["type"]!="wiki",c["s"])):
    if any(abs(k["s"]-c["s"])<55 for k in keep) and not c["rare"] and c["type"]!="wiki": continue
    if any(k["title"].split(" ")[:3]==c["title"].split(" ")[:3] for k in keep): continue
    keep.append(c)
keep.sort(key=lambda c:c["s"])
d["cards"]=keep
json.dump(d,open(f"{ROOT}/data/route.json","w"),ensure_ascii=False)
for c in keep: print(round(c["s"]),c["type"],c.get("year"),"★" if c["rare"] else "",c["title"][:60],"|",c.get("license") or "",bool(c.get("img")))
print(len(keep))
