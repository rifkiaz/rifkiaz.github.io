"""Build data/hargacloud.json from AWS Price List bulk files + GCP sources.
Inputs (in DL): aws/out-<region>.json (aws_extract.py), pricing.yml (Cyclenerd, from Cloud Billing API),
sql.html / lb.html / net.html (cloud.google.com pricing pages, embedded per-region tables)."""
import json,re,sys,yaml
from gtab import tables
DL=sys.argv[1]; OUT=sys.argv[2]
REG=[('jkt','Jakarta','ap-southeast-3','asia-southeast2'),('sg','Singapura','ap-southeast-1','asia-southeast1'),
     ('tyo','Tokyo','ap-northeast-1','asia-northeast1'),('va','Virginia (AS)','us-east-1','us-east4')]
EC2=['t3.micro','t3.small','t3.medium','t3.large','t3.xlarge','m6i.large','m6i.xlarge','m6i.2xlarge','c5.large','c5.xlarge','r5.large','r5.xlarge']
GCE=['e2-micro','e2-small','e2-medium','e2-standard-2','e2-standard-4','n2-standard-2','n2-standard-4','n2-standard-8','n2-highcpu-2','n2-highcpu-4','n2-highmem-2','n2-highmem-4']
RDS=['db.t3.micro','db.t3.small','db.t3.medium','db.t3.large','db.m6i.large','db.m6i.xlarge','db.r5.large']
num=lambda s: float(re.search(r'\$([0-9.]+)',s).group(1))
r4=lambda x: round(x,6)
y=yaml.safe_load(open(f'{DL}/pricing.yml'))
out={"asOf":"2026-10-16",'regions':[{'id':i,'name':n,'aws':a,'gcp':g} for i,n,a,g in REG],
     'spec':{'ec2':{},'gce':{},'rds':{}},'aws':{},'gcp':{}}
for rid,_,ar,gr in REG:
    a=json.load(open(f'{DL}/aws/out-{ar}.json'))
    out['aws'][rid]={
        'ec2':{t:[a['ec2'][t]['h'],a['ri'][t]['1yr'],a['ri'][t]['3yr']] for t in EC2},
        'ebs':{'ssd':a['ebs']['gp3'],'hdd':a['ebs']['st1']},
        's3':{'std':a['s3_std'],'ia':a['s3_ia'][0][2],'arch':a['s3_arch'][0][2]},
        'rds':{e.lower()[:2]:{t:[a['rds'][e]['inst'][t]['Single-AZ'],a['rds'][e]['inst'][t]['Multi-AZ']] for t in RDS} for e in ('MySQL','PostgreSQL')},
        'rdsGp3':[a['rds']['MySQL']['gp3']['Single-AZ'],a['rds']['MySQL']['gp3']['Multi-AZ']],
        'lb':[a['alb_h'],a['alb_lcu']],'nat':[a['nat']['h'],a['nat']['gb']],'ip':a['ip_h'],'k8s':a['eks_h'],
        'egress':a['egress']}
    for t in EC2: out['spec']['ec2'][t]=[a['ec2'][t]['vcpu'],float(a['ec2'][t]['mem'].split()[0])]
    for t in RDS:
        i=a['rds']['MySQL']['inst'][t]; out['spec']['rds'][t]=[i['vcpu'],float(i['mem'].split()[0])]
    inst=y['compute']['instance']
    gce={}
    for t in GCE:
        c=inst[t]['cost'][gr]; gce[t]=[r4(c['hour']),r4(c['month_1y']/730),r4(c['month_3y']/730)]
        out['spec']['gce'][t]=[inst[t]['cpu'],inst[t]['ram']]
    sq=tables(f'{DL}/sql.html',gr)
    cpu=sq[0][1]; assert cpu[0][0]=='vCPUs' and cpu[3][0]=='HA Memory', cpu
    st=[x for x in sq if len(x[1])>1 and x[1][1][0]=='SSD storage capacity']
    sql={'cpu':[num(cpu[0][1][0]),num(cpu[2][1][0])],'mem':[num(cpu[1][1][0]),num(cpu[3][1][0])],
         'ssd':[r4(num(st[0][1][1][1][0])*730),r4(num(st[2][1][1][1][0])*730)]}
    lb=tables(f'{DL}/lb.html',gr)[0][1]; assert 'data processed' in lb[1][0]
    # premium tier internet egress, per destination group, from the network pricing page
    t=open(f'{DL}/net.html').read(); eg={}
    marks=list(re.finditer(r'\]\]\]\],"[^"]*?\([a-z0-9-]+\)",\[\d\]',t))
    for k,m in enumerate(marks):
        if gr not in m.group(0): continue
        ch=t[marks[k-1].end() if k else 0:m.end()]
        if 'data transfer out) TO' not in ch: continue
        items=[re.sub(r'\\u003c/?p\\u003e','',i) for i in re.findall(r'"((?:\\u003cp\\u003e)?(?:Network \(data transfer out\) TO [^"]*?|[0-9,]+ gibibyte[^"]*?|\$[^"]*?))"',ch)]
        cur=None
        for it in items:
            if it.startswith('Network'): cur=it; eg[cur]=[]
            elif it.startswith('$') and cur: eg[cur][-1].append(num(it))
            elif cur: lo,hi=re.match(r'([0-9,]+) gibibyte(?: to ([0-9,]+) gibibyte| and above)',it).groups(); eg[cur].append([float(lo.replace(',','')),float(hi.replace(',','')) if hi else None])
        break
    pick=lambda key: [[lo,hi,p] for lo,hi,p in next(v for k2,v in eg.items() if key in k2)]
    snat=y['compute']['network']['nat']
    out['gcp'][rid]={'gce':gce,
        'pd':{'ssd':y['compute']['storage']['balanced']['cost'][gr]['month'],'hdd':y['compute']['storage']['hdd']['cost'][gr]['month']},
        'gcs':{'std':y['storage']['bucket']['standard']['cost'][gr]['month'],'ia':y['storage']['bucket']['nearline']['cost'][gr]['month'],'arch':y['storage']['bucket']['archiv']['cost'][gr]['month']},
        'sql':sql,'lb':[0.025,num(lb[1][1][0])],
        'nat':[snat['gateway']['cost'][gr]['hour'],snat['data']['cost'][gr]['month']],
        'ip':y['compute']['network']['ip']['vm']['cost'][gr]['hour'],'k8s':0.10,
        'egress':{'id':pick('Indonesia, Korea'),'asia':pick('TO Asia'),'us':pick('North America')}}
json.dump(out,open(OUT,'w'),separators=(',',':'))
print(json.dumps(out['gcp']['jkt'])); print(json.dumps(out['aws']['jkt'])[:1500]); print(len(open(OUT).read()))
