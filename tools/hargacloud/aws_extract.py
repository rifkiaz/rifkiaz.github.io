import json,sys,re
norm=lambda u: re.sub(r'^[A-Z]{2,4}\d-','',u)
EC2=['c5.large','c5.xlarge','r5.large','r5.xlarge','m5.large','m5.xlarge','t3.micro','t3.small','t3.medium','t3.large','t3.xlarge','m6i.large','m6i.xlarge','m6i.2xlarge','c6i.large','c6i.xlarge','r6i.large','r6i.xlarge']
RDS=['db.t3.micro','db.t3.small','db.t3.medium','db.t3.large','db.m6i.large','db.m6i.xlarge','db.r6i.large','db.m5.large','db.m5.xlarge','db.r5.large']
def dims(d,kind,sku):
    t=d['terms'].get(kind,{}).get(sku,{})
    return t
def od_price(d,sku):
    t=d['terms']['OnDemand'].get(sku)
    if not t: return None
    pds=[pd for o in t.values() for pd in o['priceDimensions'].values()]
    return pds
def tiers(pds):
    return [[float(p['beginRange']), None if p['endRange']=='Inf' else float(p['endRange']), float(p['pricePerUnit']['USD'])] for p in sorted(pds,key=lambda p:float(p['beginRange']))]
def ec2(path):
    d=json.load(open(path)); out={'ec2':{},'ri':{},'ebs':{},'nat':{}}
    for sku,p in d['products'].items():
        a=p['attributes']; fam=p.get('productFamily')
        if fam=='Compute Instance' and a.get('instanceType') in EC2 and a.get('operatingSystem')=='Linux' and a.get('tenancy')=='Shared' and a.get('preInstalledSw')=='NA' and a.get('capacitystatus')=='Used' and a.get('licenseModel')=='No License required':
            it=a['instanceType']; pds=od_price(d,sku)
            out['ec2'][it]={'h':float(pds[0]['pricePerUnit']['USD']),'vcpu':int(a['vcpu']),'mem':a['memory']}
            for o in d['terms'].get('Reserved',{}).get(sku,{}).values():
                ta=o['termAttributes']
                if ta.get('PurchaseOption')=='No Upfront' and ta.get('OfferingClass')=='standard':
                    h=[float(pd['pricePerUnit']['USD']) for pd in o['priceDimensions'].values() if pd['unit']=='Hrs']
                    out['ri'].setdefault(it,{})[ta['LeaseContractLength']]=h[0]
        elif fam=='Storage' and a.get('volumeApiName') in ('gp3','st1','sc1','gp2'):
            out['ebs'][a['volumeApiName']]=float(od_price(d,sku)[0]['pricePerUnit']['USD'])
        elif fam=='NAT Gateway':
            ut=a.get('usagetype','')
            k='h' if ut.endswith('NatGateway-Hours') else 'gb' if ut.endswith('NatGateway-Bytes') else None
            if k: out['nat'][k]=float(od_price(d,sku)[0]['pricePerUnit']['USD'])
    return out
def rds(path):
    d=json.load(open(path)); out={}
    for sku,p in d['products'].items():
        a=p['attributes']; fam=p.get('productFamily')
        eng=a.get('databaseEngine')
        if eng not in ('MySQL','PostgreSQL'): continue
        if fam=='Database Instance' and a.get('instanceType') in RDS and a.get('deploymentOption') in ('Single-AZ','Multi-AZ') and 'Outposts' not in a.get('usagetype','') and a.get('licenseModel','No license required').lower().startswith('no'):
            pds=od_price(d,sku)
            if not pds: continue
            out.setdefault(eng,{}).setdefault('inst',{}).setdefault(a['instanceType'],{})[a['deploymentOption']]=float(pds[0]['pricePerUnit']['USD'])
            out[eng]['inst'][a['instanceType']]['vcpu']=int(a['vcpu']); out[eng]['inst'][a['instanceType']]['mem']=a['memory']
        elif fam=='Database Storage' and a.get('volumeType')=='General Purpose-GP3' and a.get('deploymentOption') in ('Single-AZ','Multi-AZ'):
            out.setdefault(eng,{}).setdefault('gp3',{})[a['deploymentOption']]=float(od_price(d,sku)[0]['pricePerUnit']['USD'])
    return out
def simple(dir,r):
    j=lambda s: json.load(open(f'{dir}/{s}-{r}.json'))
    o={}
    d=j('AWSELB')
    for sku,p in d['products'].items():
        ut=norm(p['attributes'].get('usagetype','')); op=p['attributes'].get('operation')
        if op=='LoadBalancing:Application' and ut=='LoadBalancerUsage' and 'Outposts' not in ut: o['alb_h']=float(od_price(d,sku)[0]['pricePerUnit']['USD'])
        if op=='LoadBalancing:Application' and ut=='LCUUsage': o['alb_lcu']=float(od_price(d,sku)[0]['pricePerUnit']['USD'])
    d=j('AmazonVPC')
    for sku,p in d['products'].items():
        if p['attributes'].get('usagetype','').endswith('PublicIPv4:InUseAddress'): o['ip_h']=float(od_price(d,sku)[0]['pricePerUnit']['USD'])
    d=j('AmazonEKS')
    for sku,p in d['products'].items():
        if p['attributes'].get('usagetype','').endswith('AmazonEKS-Hours:perCluster'): o['eks_h']=float(od_price(d,sku)[0]['pricePerUnit']['USD'])
    d=j('AmazonS3')
    for sku,p in d['products'].items():
        ut=p['attributes'].get('usagetype','')
        for suf,k in (('-TimedStorage-ByteHrs','std'),('-TimedStorage-SIA-ByteHrs','ia'),('-TimedStorage-GlacierByteHrs','arch')):
            if norm(ut)==suf[1:] and p.get('productFamily')=='Storage': o['s3_'+k]=tiers(od_price(d,sku))
    d=j('AWSDataTransfer')
    for sku,p in d['products'].items():
        a=p['attributes']
        if a.get('transferType')=='AWS Outbound' and a.get('toLocation')=='External' and not a.get('usagetype','').startswith('Global'):
            o['egress']=tiers(od_price(d,sku))
    return o
if __name__=='__main__':
    dir,r=sys.argv[1],sys.argv[2]
    res=simple(dir,r); res.update(ec2(f'{dir}/AmazonEC2-{r}.json')); res['rds']=rds(f'{dir}/AmazonRDS-{r}.json')
    json.dump(res,open(f'{dir}/out-{r}.json','w'),indent=1)
    print(json.dumps(res)[:6000])
