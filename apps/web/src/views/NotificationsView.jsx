import { useState } from "react";
import { NOTIFICATIONS } from "../data/mock.js";
import { D } from "../design/tokens.js";
import { Badge, Btn, Card, SectionHeader } from "../ui/primitives.jsx";

function NotificationsView({ role }) {
  const [notifs, setNotifs] = useState(NOTIFICATIONS);
  const markAll = () => setNotifs(n=>n.map(x=>({...x,read:true})));
  const unread = notifs.filter(n=>!n.read).length;
  const ic = t => t==="match"?"🏏":t==="injury"?"🏥":t==="training"?"💪":t==="transport"?"🚌":t==="skills"?"🎯":"📢";
  const uc = u => u==="high"?D.rose:u==="medium"?D.amber:D.textMuted;
  return (
    <div className="os-page">
      <SectionHeader title="Notifications" sub={`${unread} unread alerts`} color={D.rose}
        actions={unread>0&&<Btn size="sm" variant="ghost" onClick={markAll}>Mark all read</Btn>}/>
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {notifs.map(n=>(
          <Card key={n.id} sx={{padding:"14px 16px",background:n.read?"transparent":D.indigo+"08",border:`1px solid ${n.read?D.border:D.indigo+"22"}`}}
            onClick={()=>setNotifs(ns=>ns.map(x=>x.id===n.id?{...x,read:true}:x))}>
            <div style={{display:"flex",gap:"12px",alignItems:"flex-start"}}>
              <div style={{width:"36px",height:"36px",borderRadius:D.md,background:uc(n.urgency)+"18",border:`1px solid ${uc(n.urgency)}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",flexShrink:0}}>
                {ic(n.type)}
              </div>
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"3px"}}>
                  <span style={{fontFamily:D.body,fontSize:"13px",fontWeight:n.read?400:700,color:D.textPrimary}}>{n.title}</span>
                  <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}>
                    <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{n.time}</span>
                    {!n.read&&<div style={{width:"7px",height:"7px",borderRadius:"50%",background:uc(n.urgency)}}/>}
                  </div>
                </div>
                <p style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.5}}>{n.body}</p>
                <div style={{display:"flex",gap:"5px",marginTop:"6px"}}>
                  <Badge color={uc(n.urgency)}>{n.urgency}</Badge>
                  <Badge color={D.textMuted}>{n.type}</Badge>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export { NotificationsView };
