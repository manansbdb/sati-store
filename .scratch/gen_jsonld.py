import re, json
root = "/Users/matheuscarvalho/apps/sati-store"
html = open(f"{root}/index.html", encoding="utf-8").read()

PLAT = {"instagram": "Instagram", "tiktok": "TikTok", "youtube": "YouTube", "x": "X", "facebook": "Facebook", "telegram": "Telegram", "threads": "Threads"}
IMG = "https://getati.store/assets/og.png"
ORG_ID = "#org"
r2 = lambda x: round(x * 100) / 100

prods = []
for line in html.splitlines():
    m = re.search(r'\{id:"([a-z0-9_]+)",platform:"([a-z]+)",name:"([^"]*)",blurb:"([^"]*)",per:([0-9.]+),unitSize:(\d+),min:(\d+)', line)
    if not m:
        continue
    sid, plat, name, blurb, per, us, mn = m.group(1), m.group(2), m.group(3), m.group(4), float(m.group(5)), int(m.group(6)), int(m.group(7))
    frm = r2(per) if us == 1000 else r2(per * mn / us)
    prods.append({
        "@type": "Product",
        "name": f"{PLAT.get(plat, plat.title())} {name}",
        "description": blurb,
        "sku": sid,
        "image": IMG,
        "brand": {"@type": "Brand", "name": "SATI"},
        "offers": {"@type": "Offer", "price": frm, "priceCurrency": "USD", "availability": "https://schema.org/InStock", "url": "https://getati.store/", "seller": {"@id": ORG_ID}},
        "url": "https://getati.store/",
    })

# Coleções fixas (SKUs com preco fechado)
for line in html.splitlines():
    m = re.search(r'\{id:"(eclat|maison|signature)",\s*name:"([^"]*)",\s*price:(\d+)', line)
    if m and "items:[" in line:
        pid, pname, price = m.group(1), m.group(2), int(m.group(3))
        prods.append({
            "@type": "Product",
            "name": f"{pname} Collection",
            "description": "Curated SATI growth bundle across followers, likes, views and comments — one platform, your choice.",
            "sku": "pkg_" + pid,
            "image": IMG,
            "brand": {"@type": "Brand", "name": "SATI"},
            "offers": {"@type": "Offer", "price": price, "priceCurrency": "USD", "availability": "https://schema.org/InStock", "url": "https://getati.store/", "seller": {"@id": ORG_ID}},
            "url": "https://getati.store/",
        })

graph = [
    {"@type": "WebSite", "@id": "#website", "name": "SATI", "alternateName": "The Growth Atelier", "url": "https://getati.store/", "inLanguage": "en", "publisher": {"@id": ORG_ID}},
    {"@type": "Organization", "@id": ORG_ID, "name": "SATI", "alternateName": "The Growth Atelier", "url": "https://getati.store/",
     "logo": {"@type": "ImageObject", "url": "https://getati.store/assets/icon-512.png"},
     "description": "Private growth atelier: curated Instagram, TikTok, YouTube, X, Facebook, Telegram and Threads engagement, delivered discreetly. No password required.",
     "email": "forwardingagent290@gmail.com",
     "makesOffer": {"@type": "OfferCatalog", "name": "SATI Services", "itemListElement": [{"item": p} for p in prods]}},
]

graph_json = json.dumps({"@context": "https://schema.org", "@graph": graph}, separators=(",", ":"), ensure_ascii=False)
newblock = '<script type="application/ld+json">\n' + graph_json + '\n</script>'

html2, n = re.subn(r'<script type="application/ld\+json">.*?</script>', lambda _: newblock, html, count=1, flags=re.S)
open(f"{root}/index.html", "w", encoding="utf-8").write(html2)

# valida o JSON gerado
inner = re.search(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', open(f"{root}/index.html", encoding="utf-8").read(), flags=re.S).group(1)
parsed = json.loads(inner)
print("blocos trocados:", n, "| produtos:", len(prods), "| bytes json:", len(graph_json))
print("primeiro produto:", json.dumps(prods[0]["name"], ensure_ascii=False), prods[0]["offers"]["price"])
print("ultima oferta:", prods[-1]["name"], prods[-1]["offers"]["price"], prods[-1]["offers"]["priceCurrency"])
print("valido:", parsed["@graph"][0]["@type"], "+", parsed["@graph"][1]["@type"])
