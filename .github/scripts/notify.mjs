rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function canImage(id) {
      let room = get(/databases/$(database)/documents/rooms/$(id)).data;
      return !room.get('imageAdminOnly', false) || room.createdBy == request.auth.uid || request.auth.uid in room.get('admins', []);
    }
    function isMember(col, id) {
      return request.auth.uid in get(/databases/$(database)/documents/$(col)/$(id)).data.members;
    }
    match /users/{uid} {
      allow read: if signedIn();
      allow create, update, delete: if signedIn() && request.auth.uid == uid;
    }
    match /invites/{id} { allow read, create: if signedIn(); }
    match /rooms/{id} {
      allow read: if signedIn();
      allow create: if signedIn() && request.auth.uid in request.resource.data.members;
      allow update: if signedIn() && (
        // 作成者: すべて変更できる
        resource.data.createdBy == request.auth.uid
        // 管理者: 管理者の追加と作成者の変更以外ができる（BANなど）
        || (request.auth.uid in resource.data.get('admins', [])
            && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['admins','createdBy'])
            && resource.data.createdBy in request.resource.data.members)
        // 一般メンバー: 管理者・BAN・画像設定は変更できない
        || (request.auth.uid in resource.data.members
            && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['admins','createdBy','banned','imageAdminOnly']))
        // 参加（BANされている人は入れない）
        || (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['members'])
            && !(request.auth.uid in resource.data.get('banned', []))
            && request.resource.data.members.hasAll(resource.data.members))
      );
      allow delete: if signedIn() && (
        resource.data.createdBy == request.auth.uid
        || request.auth.uid in resource.data.get('admins', [])
      );
      match /messages/{mid} {
        allow read, update, delete: if signedIn() && isMember('rooms', id);
        allow create: if signedIn() && isMember('rooms', id)
          && (!request.resource.data.get('hasImage', false) || canImage(id));
      }
      match /images/{iid} {
        allow read, delete: if signedIn() && isMember('rooms', id);
        allow create: if signedIn() && isMember('rooms', id) && canImage(id);
      }
      match /calls/{document=**} { allow read, write: if signedIn() && isMember('rooms', id); }
    }
    match /dms/{id} {
      allow read: if signedIn() && (resource == null || request.auth.uid in resource.data.members);
      allow create: if signedIn() && request.auth.uid in request.resource.data.members;
      allow update, delete: if signedIn() && request.auth.uid in resource.data.members;
      match /messages/{mid} { allow read, write: if signedIn() && isMember('dms', id); }
      match /images/{iid} { allow read, write: if signedIn() && isMember('dms', id); }
      match /calls/{document=**} { allow read, write: if signedIn() && isMember('dms', id); }
    }
  }
}
