import ctypes
assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0
def strict_exists(path):
 try:
  path.stat()
  return True
 except FileNotFoundError:
  return False
import json,os,signal,subprocess,sys,time
from pathlib import Path
read_fd,write_fd=os.pipe()
child=subprocess.Popen([sys.argv[1],sys.argv[2],'--allocation',sys.argv[3],'--private-directory',sys.argv[4],'--token-fd',str(read_fd),'--test-endpoint',sys.argv[5]],pass_fds=(read_fd,),stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
os.close(read_fd)
os.write(write_fd,b'SYNTHETIC_PARTIAL_PRIVATE_TOKEN')
reader=None
limit=time.monotonic()+2
while time.monotonic()<limit:
 children=Path('/proc/'+str(child.pid)+'/task/'+str(child.pid)+'/children').read_text().split()
 if children:
  reader=int(children[0])
  break
 time.sleep(0.01)
assert reader is not None
# Leave EOF withheld; allow the reader to consume the partial private bytes.
time.sleep(0.25)
assert strict_exists(Path('/proc/'+str(reader)+'/fd/3'))
child.kill()
stdout,stderr=child.communicate(timeout=2)
def state():
 try:
  return Path('/proc/'+str(reader)+'/stat').read_text().rsplit(')',1)[1].split()[0]
 except FileNotFoundError:
  return 'ABSENT'
limit=time.monotonic()+6
while time.monotonic()<limit and state() not in ('Z','ABSENT'):
 time.sleep(0.02)
terminal=state()
try:
 fd_retained=strict_exists(Path('/proc/'+str(reader)+'/fd/3'))
finally:
 if terminal=='Z': os.waitpid(reader,0)
pipe_closed=False
try:
 os.write(write_fd,b'PRIVATE_SYNTHETIC_PROBE')
except BrokenPipeError:
 pipe_closed=True
finally:
 if terminal not in ('Z','ABSENT'):
  os.kill(reader,signal.SIGKILL)
 os.close(write_fd)
print(json.dumps({'readerState':terminal,'fdRetained':fd_retained,'pipeClosed':pipe_closed,'code':child.returncode,'stdout':stdout.decode(),'stderr':stderr.decode()}))