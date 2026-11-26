/** Coalesce small UI/draft writes. Never wait for unload to make a first save. */
export function createSessionSaver({read,write,onStatus=()=>{},delay=250}) {
  let timer=null,tail=Promise.resolve(),generation=0,saved=0,lastKey='',failure=null,active=0;
  function status(state,error=null){onStatus({state,error});}
  function schedule(){
    generation++;status('pending');clearTimeout(timer);
    timer=setTimeout(()=>{timer=null;void flush().catch(()=>{});},delay);
  }
  function flush(){
    clearTimeout(timer);timer=null;
    let value;try{value=read();}catch(error){failure={token:generation,error};status('failed',error);return Promise.reject(error);}
    if(!value)return tail;
    const token=generation,key=JSON.stringify(value);
    active++;
    const job=tail.catch(()=>{}).then(async()=>{
      if(key!==lastKey){await write(value);lastKey=key;}
      saved=Math.max(saved,token);if(!failure||failure.token<=token)failure=null;
    });
    tail=job.catch(()=>{});
    return job.then(()=>{active--;if(failure)status('failed',failure.error);else status(saved<generation?'pending':'saved');},error=>{
      active--;lastKey='';if(!failure||failure.token<=token)failure={token,error};status('failed',failure.error);throw error;
    });
  }
  async function pause(){clearTimeout(timer);timer=null;await tail;}
  function reset(){clearTimeout(timer);timer=null;generation=0;saved=0;lastKey='';failure=null;status('idle');}
  return {schedule,flush,pause,reset,get unsettled(){return Boolean(failure)||active>0||saved<generation;}};
}
