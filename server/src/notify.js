// 계정에 묶인 기기로 보내는 알림 (커뮤니티 댓글 등 경기와 상관없는 것)
import { alertPayload, isDeadToken } from './apns.js';
import { wants } from './messages.js';

export function createNotifier({ store, apns, log = () => {} }) {
  return {
    /** userId 의 기기 중 이 알림을 켠 곳에 보낸다. 보낸 기기 수 */
    async toUser(userId, msg) {
      let sent = 0;
      for (const d of store.userDevices(userId)) {
        if (!wants(d.prefs, { type: msg.type })) continue;
        const r = await apns.send({ env: d.env, token: d.token, pushType: 'alert', priority: 10, payload: alertPayload(msg), collapseId: msg.collapseId });
        if (r.ok) sent++;
        else if (isDeadToken(r)) store.deleteDevice(d.token);
      }
      log(`${msg.type} → 기기 ${sent}대`);
      return sent;
    },
  };
}
