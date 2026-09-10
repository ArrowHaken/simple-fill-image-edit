import { api } from './api.js';
export const isTerminal = task => ['completed','failed','interrupted','cancelled'].includes(task.status);
export class TaskController {
  constructor(onTask, onConnection) { this.items=new Map(); this.onTask=onTask; this.onConnection=onConnection; }
  watch(pid, task) {
    const key=`${pid}:${task.id}`;
    if (isTerminal(task) || this.items.has(key)) return;
    const item={pid,id:task.id,failures:0,stopped:false}; this.items.set(key,item);
    const poll=async()=>{
      if(item.stopped) return;
      try {
        const value=await api(`/api/projects/${pid}/tasks/${task.id}`);
        if(item.stopped) return;
        item.failures=0; await this.onTask(pid,value);
        if(isTerminal(value)){this.items.delete(key);return;}
      } catch(error) { item.failures++; this.onConnection(pid,error); }
      if(!item.stopped) item.timer=setTimeout(poll,Math.min(15000,2000*2**Math.min(item.failures,3)));
    };
    poll();
  }
  stopAll(){for(const item of this.items.values()){item.stopped=true;clearTimeout(item.timer);}this.items.clear();}
  stopProject(pid){for(const [key,item] of this.items){if(item.pid===pid){item.stopped=true;clearTimeout(item.timer);this.items.delete(key);}}}
}
