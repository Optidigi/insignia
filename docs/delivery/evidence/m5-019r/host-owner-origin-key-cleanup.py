import pathlib,os,json,hashlib,subprocess
p=pathlib.Path.home()/'.ssh/authorized_keys'
assert not p.is_symlink() and p.stat().st_uid==os.getuid()
data=p.read_bytes();line=b'restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPdf+8/hlgAtbfgE+h7XYXq+pQa3Y6oL6grvwjWnNsNj insignia-m5-019r-temporary'
rows=data.splitlines(keepends=True);matches=[x for x in rows if x.rstrip(b'\r\n')==line]
assert len(matches)==1,'exact temporary key count mismatch'
new=b''.join(x for x in rows if x.rstrip(b'\r\n')!=line)
t=p.with_name('authorized_keys.m5-019r-cleanup.tmp');fd=os.open(t,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as f:f.write(new);f.flush();os.fsync(f.fileno())
os.replace(t,p);fd=os.open(p.parent,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
assert p.read_bytes()==new and line not in p.read_bytes()
fingerprint=subprocess.check_output(['ssh-keygen','-lf','/etc/ssh/ssh_host_ed25519_key.pub'],text=True).split()[1]
assert fingerprint=='SHA256:vttVPAISQypNdyfjFElTJ6ef8Q5S2YlC+XoUn599uq4'
print(json.dumps({'classification':'TEMPORARY_KEY_REVOKED','removedExactAuthorizedKeyLines':1,'otherAuthorizedKeyBytesPreserved':True,'trustedHostFingerprint':fingerprint,'mode':oct(p.stat().st_mode&0o777)}))
