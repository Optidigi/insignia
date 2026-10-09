import hashlib,json,re,signal,ssl,sys,urllib.error,urllib.request
from pathlib import Path
CAP=1048576
INDEX='sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336'
ROOT='https://public.ecr.aws/v2/docker/library/postgres/manifests/'
TOKEN_URL='https://public.ecr.aws/token/?service=public.ecr.aws&scope=repository%3Adocker%2Flibrary%2Fpostgres%3Apull'
ACCEPT=','.join(('application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json','application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json'))
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl): return None
context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
context.load_verify_locations(cafile='/etc/ssl/certs/ca-certificates.crt')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=context))
requests=[]
receipt={'classification':'UNQUALIFIED','referenceIndexDigest':INDEX,'requests':requests,'limits':{'maximumGetAttempts':4,'maxBytesPerResponse':CAP,'requestTimeoutSeconds':10,'hardProcessDeadlineSeconds':60,'redirectsAllowed':False,'sslVerified':True,'tokensPersistedOrPrinted':False,'layerBlobsDownloaded':False}}
class Stop(Exception): pass
def deadline(signum,frame): raise Stop('PUBLIC_READ_DEADLINE')
signal.signal(signal.SIGALRM,deadline); signal.alarm(60)
def get(url,token=None):
    if len(requests)>=4 or not(url==TOKEN_URL or url.startswith(ROOT)): raise Stop('PUBLIC_READ_SCOPE')
    headers={'Accept':'application/json' if url==TOKEN_URL else ACCEPT,'User-Agent':'insignia-ci-image-identity-readonly/1'}
    if token is not None: headers['Authorization']='Bearer '+token
    requests.append({'url':url,'status':'ATTEMPTED'})
    try: response=opener.open(urllib.request.Request(url,headers=headers,method='GET'),timeout=10)
    except urllib.error.HTTPError as error: response=error
    with response:
        data=response.read(CAP+1)
        if len(data)>CAP: raise Stop('PUBLIC_RESPONSE_LIMIT')
        row={'url':url,'status':response.status,'bytes':len(data),'contentType':response.headers.get('Content-Type')}
        if url!=TOKEN_URL: row.update(bodySha256=hashlib.sha256(data).hexdigest(),dockerContentDigest=response.headers.get('Docker-Content-Digest'))
        requests[-1]=row
        return response.status,data,response.headers

def verify(data,headers,expected):
    calculated='sha256:'+hashlib.sha256(data).hexdigest()
    if calculated!=expected: raise Stop('PUBLIC_MANIFEST_BODY_DIGEST_MISMATCH')
    supplied=headers.get('Docker-Content-Digest')
    if supplied is not None and supplied!=calculated: raise Stop('PUBLIC_MANIFEST_HEADER_DIGEST_MISMATCH')
    result=json.loads(data)
    if result.get('schemaVersion')!=2: raise Stop('PUBLIC_MANIFEST_SCHEMA')
    return result
try:
    status,data,headers=get(ROOT+INDEX)
    token=None
    if status==401:
        challenge=headers.get('WWW-Authenticate','')
        if not challenge.startswith('Bearer ') or 'realm="https://public.ecr.aws/token/"' not in challenge: raise Stop('PUBLIC_AUTH_REALM')
        status,token_data,_=get(TOKEN_URL)
        if status!=200: raise Stop('PUBLIC_ANONYMOUS_TOKEN_UNAVAILABLE')
        token=json.loads(token_data).get('token')
        if not isinstance(token,str) or not 0<len(token)<CAP: raise Stop('PUBLIC_ANONYMOUS_TOKEN_INVALID')
        status,data,headers=get(ROOT+INDEX,token)
    if status!=200: raise Stop('PUBLIC_INDEX_UNAVAILABLE')
    index=verify(data,headers,INDEX)
    descriptors=[item for item in index.get('manifests',[]) if item.get('platform',{}).get('os')=='linux' and item.get('platform',{}).get('architecture')=='amd64']
    if len(descriptors)!=1: raise Stop('PUBLIC_AMD64_DESCRIPTOR_UNQUALIFIED')
    descriptor=descriptors[0]
    digest=descriptor['digest']
    if not re.fullmatch('sha256:[a-f0-9]{64}',digest): raise Stop('PUBLIC_AMD64_DESCRIPTOR_INVALID')
    status,data,headers=get(ROOT+digest,token)
    if status!=200: raise Stop('PUBLIC_AMD64_UNAVAILABLE')
    image=verify(data,headers,digest)
    config=image['config']['digest']; layers=[item['digest'] for item in image['layers']]
    if not layers or not all(re.fullmatch('sha256:[a-f0-9]{64}',item) for item in [config,*layers]): raise Stop('PUBLIC_IMAGE_DIGEST_VECTOR_INVALID')
    receipt.update(classification='HISTORICAL_INDEX_CONTENT_IDENTICAL_AMD64_VERIFIED',imageReference='public.ecr.aws/docker/library/postgres@'+INDEX,indexUrl=ROOT+INDEX,indexBodySha256=INDEX[7:],amd64Url=ROOT+digest,amd64ManifestDigest=digest,amd64Descriptor=descriptor,configDigest=config,layerDigests=layers,index=index,amd64Manifest=image,proofLimit='Docker Hub historical pull digest is the reference. Exact ECR index bytes match that digest and bind every descriptor; selected amd64 bytes match its descriptor. No Docker Hub re-fetch or layer/config blob downloads in this four-read probe.')
except Stop as error: receipt['stopCategory']=str(error)
except Exception as error: receipt['stopCategory']='PUBLIC_READ_OR_METADATA_FAILURE'; receipt['errorType']=type(error).__name__
finally:
    token=None
    signal.alarm(0)
    file=Path('/home/serveradmin/insignia-milestone-autonomy-handoff/artifact-size-registry-ecr-four-read-receipt.json')
    with file.open('x') as output:
        file.chmod(0o600); json.dump(receipt,output,indent=2,sort_keys=True); output.write('\n')
    print(json.dumps({key:receipt[key] for key in ('classification','stopCategory','imageReference','amd64ManifestDigest','configDigest','layerDigests') if key in receipt},indent=2))
    print('publicReceiptSha256='+hashlib.sha256(file.read_bytes()).hexdigest())
    print('publicGetAttempts='+str(len(requests)))
