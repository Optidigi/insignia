"""Validate/extract only the public pinned SDK code archive. No install/auth/network operation."""
import hashlib,json,os,pathlib,sys,tarfile
assert not sys.flags.optimize and len(sys.argv)==3
archive=pathlib.Path(sys.argv[1]);destination=pathlib.Path(sys.argv[2])
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='0b1c01d1ebf1f1265826a4ffa78ea94bc4c2eb8a36beb9b2f5fb305ef30231ff'
assert not destination.exists();members={};total=0
with tarfile.open(archive,'r:gz') as stream:
 for item in stream:
  path=pathlib.PurePosixPath(item.name)
  assert not path.is_absolute() and '..' not in path.parts and path.parts[0]=='package'
  assert item.isdir() or item.isfile()
  if item.isfile():
   assert item.name not in members and 0<=item.size<20000000
   total+=item.size;assert total<100000000
   members[item.name]=stream.extractfile(item).read()
assert len(members)==604 and json.loads(members['package/package.json'])['version']=='4.8.2'
destination.mkdir(mode=0o700)
for name,body in members.items():
 path=destination/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o400)
 with os.fdopen(fd,'wb') as file:file.write(body)
print(json.dumps({'classification':'PINNED_PUBLIC_SDK_CODE_EXTRACTED_ONLY','members':604,'authentication':False,'installScripts':False}))
