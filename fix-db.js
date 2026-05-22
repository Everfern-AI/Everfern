const sqlite3 = require('sqlite3');
const path = require('path');
const os = require('os');
const dbPath = path.join(os.homedir(), '.everfern', 'sql', 'memory.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error('DB Open Error:', err); return; }
  db.all("SELECT id, tool_calls, mission_timeline FROM messages WHERE tool_calls IS NOT NULL AND tool_calls != '[]' AND (mission_timeline IS NULL OR mission_timeline = 'null')", (err, rows) => {
    if (err) { console.error('Select Error:', err); return; }
    console.log('Found ' + rows.length + ' messages to update.');
    let updated = 0;
    db.serialize(() => {
      const stmt = db.prepare('UPDATE messages SET mission_timeline = ?, has_timeline = 1 WHERE id = ?');
      for (const row of rows) {
        try {
          const tcs = JSON.parse(row.tool_calls);
          if (!tcs || tcs.length === 0) continue;
          const tl = {
            missionId: row.id,
            startTime: Date.now(),
            currentPhase: 'completion',
            isComplete: true,
            steps: tcs.map((tc, i) => ({
              id: tc.id || 'tc-'+i,
              name: tc.name || 'tool',
              description: 'Executed ' + (tc.name || 'tool'),
              phase: 'execution',
              status: 'completed',
              toolCalls: [tc.name || 'tool']
            }))
          };
          tl.totalSteps = tl.steps.length;
          tl.completedSteps = tl.steps.length;
          stmt.run(JSON.stringify(tl), row.id);
          updated++;
        } catch(e) { }
      }
      stmt.finalize(() => {
        console.log('Updated ' + updated + ' messages.');
        db.close();
      });
    });
  });
});
