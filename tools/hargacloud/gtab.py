import re,sys,json,html
def tables(path, region):
    t=open(path).read()
    out=[]
    lab=re.compile(r'\]\]\]\],"([^"]*?\('+re.escape(region)+r'\))",\[(\d)\]')
    prev=0
    marks=list(re.finditer(r'\]\]\]\],"[^"]*?\([a-z0-9-]+\)",\[\d\]',t))
    for k,m in enumerate(marks):
        start=marks[k-1].end() if k else max(0,m.start()-20000)
        if region not in m.group(0): continue
        chunk=t[start:m.end()]
        rows=[]
        for r in re.finditer(r'\[\[\[1,1,null,\[null,\[null,"((?:[^"\\]|\\.)*)"\]\]\](.*?)\]\]\]',chunk):
            label=html.unescape(re.sub(r'\\u003c.*?\\u003e|<.*?>','',r.group(1).encode().decode('unicode_escape')))
            prices=re.findall(r'"(\$[^"]*)"',r.group(2))
            rows.append((label,prices))
        out.append((m.start(),rows))
    return out
if __name__=='__main__':
    for pos,rows in tables(sys.argv[1],sys.argv[2]):
        print('@',pos, rows[:12])
