import hashlib,json,re,ssl,time,urllib.error,urllib.request
from pathlib import Path
CAP=1048576
DIGEST='sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336'
ACCEPT=','.join(('application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json','application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json'))
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl): return None
context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
context.load_verify_locations(cafile='/etc/ssl/certs/ca-certificates.crt')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=context))
requests=[]
started=time.monotonic()
def get(url,token=None,accept=ACCEPT):
    assert url.startswith(('https://registry-1.docker.io/v2/library/postgres/manifests/','https://auth.docker.io/token?','https://public.ecr.aws/v2/docker/library/postgres/manifests/','https://public.ecr.aws/token/?'))
    assert len(requests)<12 and time.monotonic()-started<80
    headers={'Accept':accept,'User-Agent':'insignia-ci-image-identity-readonly/1'}
    if token is not None: headers['Authorization']='Bearer '+token
    request=urllib.request.Request(url,headers=headers,method='GET')
    try: response=opener.open(request,timeout=min(10,80-(time.monotonic()-started)))
    except urllib.error.HTTPError as error: response=error
    with response:
        data=response.read(CAP+1)
        assert len(data)<=CAP
        row={'url':url,'status':response.status,'bytes':len(data)}
        # No authentication headers/token response bodies or digests are retained.
        if '/manifests/' in url:
            row.update(contentType=response.headers.get('Content-Type'),dockerContentDigest=response.headers.get('Docker-Content-Digest'),bodySha256=hashlib.sha256(data).hexdigest())
        requests.append(row)
        return response.status,data,response.headers

def authenticate(kind):
    if kind=='dockerHub':
        root='https://registry-1.docker.io/v2/library/postgres/manifests/'
        tokenUrl='https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fpostgres%3Apull'
        realm='https://auth.docker.io/token'
    else:
        root='https://public.ecr.aws/v2/docker/library/postgres/manifests/'
        tokenUrl='https://public.ecr.aws/token/?service=public.ecr.aws&scope=repository%3Adocker%2Flibrary%2Fpostgres%3Apull'
        realm='https://public.ecr.aws/token/'
    status,data,headers=get(root+DIGEST)
    if status==200: return root,None,(status,data,headers)
    if status!=401: return root,None,(status,data,headers)
    challenge=headers.get('WWW-Authenticate','')
    assert challenge.startswith('Bearer ') and 'realm="'+realm+'"' in challenge
    status,data,_=get(tokenUrl,accept='application/json')
    assert status==200
    values=json.loads(data)
    token=values.get('token',values.get('access_token'))
    assert isinstance(token,str) and 0<len(token)<CAP
    # Anonymous bearer remains memory-only, never printed or persisted.
    return root,token,None

def manifest(root,token,ref,cached=None):
    status,data,headers=cached or get(root+ref,token)
    if status!=200: return {'status':status}
    calculated='sha256:'+hashlib.sha256(data).hexdigest()
    assert headers.get('Docker-Content-Digest')==calculated
    if ref.startswith('sha256:'): assert calculated==ref
    value=json.loads(data)
    assert value.get('schemaVersion')==2
    return {'status':status,'digest':calculated,'body':value}

receipt={'lastSuccessfulPullDigest':DIGEST,'limits':{'maxRequests':12,'maxBytesPerResponse':CAP,'requestSeconds':10,'outerSeconds':90,'redirectsAllowed':False,'sslVerified':True,'layersDownloaded':False,'tokensPersistedOrPrinted':False},'registries':{}}
for kind in ('dockerHub','ecrPublic'):
    root,token,cached=authenticate(kind)
    index=manifest(root,token,DIGEST,cached)
    row={'historicalIndex':index}
    if index['status']!=200 and kind=='ecrPublic':
        index=manifest(root,token,'18')
        row['currentTagIndex']=index
    if index['status']==200:
        entries=index['body'].get('manifests',[])
        matches=[entry for entry in entries if entry.get('platform',{}).get('os')=='linux' and entry.get('platform',{}).get('architecture')=='amd64']
        assert len(matches)==1
        entry=matches[0]
        assert re.fullmatch('sha256:[a-f0-9]{64}',entry['digest'])
        amd64=manifest(root,token,entry['digest'])
        row['amd64']=amd64
        if amd64['status']==200:
            row['identity']={'indexDigest':index['digest'],'amd64ManifestDigest':amd64['digest'],'configDigest':amd64['body']['config']['digest'],'layerDigests':[layer['digest'] for layer in amd64['body']['layers']]}
    receipt['registries'][kind]=row
    token=None
receipt['requests']=requests
left=receipt['registries']['dockerHub'].get('identity')
right=receipt['registries']['ecrPublic'].get('identity')
receipt['exactIdentityMatches']=left is not None and right is not None and left==right
file=Path('/home/serveradmin/insignia-milestone-autonomy-handoff/artifact-size-registry-identity-receipt.json')
with file.open('x') as output:
    file.chmod(0o600); json.dump(receipt,output,indent=2,sort_keys=True); output.write('\n')
print(json.dumps({'classification':'EXACT_PUBLIC_REGISTRY_IDENTITY_MATCH' if receipt['exactIdentityMatches'] else 'REGISTRY_IDENTITY_UNQUALIFIED','requestCount':len(requests),'statuses':[row['status'] for row in requests],'dockerHubIdentity':left,'ecrPublicIdentity':right,'receiptSha256':hashlib.sha256(file.read_bytes()).hexdigest()},indent=2))
