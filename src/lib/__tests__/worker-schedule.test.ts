import {describe,it,expect} from 'vitest';
import {makeWorkerSchedule,advanceWorkerSchedule} from '../worker-schedule';
describe('worker schedule timing',()=>{
 it('moves Friday after 9 to Monday without weekend runs',()=>{const now=new Date(2026,10,6,10);const s=makeWorkerSchedule('Every weekday at 9:00',now);const d=new Date(s.nextRun);expect(d.getDay()).toBe(1);expect(d.getHours()).toBe(9);expect(d.getDate()).toBe(9)});
 it('uses today at 9 if still in the future',()=>{const s=makeWorkerSchedule('Every weekday at 9:00',new Date(2026,10,9,8));expect(new Date(s.nextRun).getDate()).toBe(9)});
 it('coalesces missed hourly runs and removes a one-time schedule after claiming',()=>{const now=new Date(2026,10,9,12);const s=makeWorkerSchedule('Every hour',new Date(2026,10,7));expect(new Date(advanceWorkerSchedule(s,now)!.nextRun).getTime()).toBe(now.getTime()+3600000);expect(advanceWorkerSchedule(makeWorkerSchedule('Tomorrow at 8:00',now),now)).toBeUndefined()});
 it('rejects unknown schedule labels',()=>expect(()=>makeWorkerSchedule('arbitrary')).toThrow());
});
