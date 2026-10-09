import json,os,sys
CONTROL_RUNTIME={'pythonVersion':sys.version,'platform':{'system':os.uname().sysname,'kernel':os.uname().release,'machine':os.uname().machine}}
def control_exception(kind,error,traceback):
 print('SYNTHETIC_CONTROL_RUNTIME '+json.dumps(CONTROL_RUNTIME),file=sys.stderr)
 sys.__excepthook__(kind,error,traceback)
sys.excepthook=control_exception
import json,os,signal,subprocess,sys,time
from pathlib import Path
retain_zombie=sys.argv[6]=='retained-zombie'
if retain_zombie:
 import ctypes
 assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0
# Explicit stat keeps observer behavior independent of Path.exists suppression.
def fd_exists():
 try:
  Path('/proc/'+str(reader)+'/fd/3').stat()
  return True
 except FileNotFoundError:
  return False
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
assert fd_exists()
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
# A terminal process has released its descriptors; a zombie's fd directory
# may be inaccessible. Still require the independent pipe EPIPE observation.
fd_retained=False if terminal in ('Z','ABSENT') else fd_exists()
pipe_closed=False
try:
 os.write(write_fd,b'PRIVATE_SYNTHETIC_PROBE')
except BrokenPipeError:
 pipe_closed=True
finally:
 if terminal not in ('Z','ABSENT'):
  os.kill(reader,signal.SIGKILL)
 os.close(write_fd)
 if retain_zombie:
  os.waitpid(reader,0)
print(json.dumps({'pythonVersion':sys.version,'platform':CONTROL_RUNTIME['platform'],'retainedZombie':retain_zombie,'readerState':terminal,'fdRetained':fd_retained,'pipeClosed':pipe_closed,'code':child.returncode,'stdout':stdout.decode(),'stderr':stderr.decode()}))
