import {createBoard} from './boards.js';

/** TS field boards use the fixed wording of the reference photo album. */
export function tsCaptureBoard(board,{route='',station=''}={}){
  const value=String(station).normalize('NFKC').trim();
  const match=value.match(/^(?:SP\s*)?(\d+(?:\.\d+)?)(?:\s*\(?[LR]\)?)?$/i);
  return createBoard('sample-2112',{...board.values,route,workType:'縁石工',location:match?`SP${match[1]}`:value,remarks:`路線名：${route}\n\n延長（偏心量）\n\n出来形計測状況`});
}
