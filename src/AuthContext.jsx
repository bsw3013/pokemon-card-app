import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, googleProvider, db } from './firebase';
import { isAdminEmail } from './config/admins';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nickname, setNicknameState] = useState(null);
  const [nicknameLoading, setNicknameLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) { setNicknameState(null); return; }
    let cancelled = false;
    setNicknameLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'userProfiles', user.uid));
        if (cancelled) return;
        setNicknameState(snap.exists() ? (snap.data().nickname || '') : '');
      } catch (err) {
        console.error('닉네임 로드 실패', err);
        if (!cancelled) setNicknameState('');
      } finally {
        if (!cancelled) setNicknameLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const setNickname = async (nextNickname) => {
    if (!user) return;
    const trimmed = String(nextNickname || '').trim().slice(0, 20);
    if (!trimmed) throw new Error('닉네임을 입력해주세요.');
    await setDoc(doc(db, 'userProfiles', user.uid), {
      nickname: trimmed,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    setNicknameState(trimmed);
  };

  const signInWithGoogle = async () => {
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('구글 로그인 실패', err);
      setError('로그인에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const signOutUser = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      console.error('로그아웃 실패', err);
    }
  };

  const value = {
    user,
    loading,
    error,
    isAdmin: isAdminEmail(user?.email),
    nickname,
    nicknameLoading,
    needsNickname: !!user && !nicknameLoading && nickname === '',
    setNickname,
    signInWithGoogle,
    signOut: signOutUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth는 AuthProvider 내부에서만 사용할 수 있습니다.');
  return ctx;
}
