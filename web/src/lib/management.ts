export {
  createIdentity,
  issueCredential,
  listIdentities,
  revokeKey,
  setIdentityDisabled,
  updateIdentity,
} from './identities.js';
export type { Invitation } from './invitations.js';
export {
  acceptInvitation,
  invitePerson,
  listInvitations,
  readInvitation,
  revokeInvitation,
} from './invitations.js';
export { listPeople, type Person, removePerson, updatePersonRole } from './people.js';
export {
  archiveProject,
  createProject,
  getProjectFacts,
  renameProject,
  restoreProject,
} from './projects.js';
