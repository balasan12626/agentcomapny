import { Pending } from '@/components/Pending';
export default function Builder() {
  return <Pending title="Agent Builder" checklistId="C-04">Agent definitions are currently edited in <code>catalog/agents.json</code>, generated with <code>npm run generate:agents</code> and versioned into MongoDB by <code>npm run seed -w server</code>. The in-app editor (draft → test run → publish → rollback) needs the agent-version write API.</Pending>;
}
