import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAQwYbUhavcaXn4L2cHlFg1Gyb19tOiFyc",
  authDomain: "biblioteca-scolara-413b3.firebaseapp.com",
  projectId: "biblioteca-scolara-413b3",
  storageBucket: "biblioteca-scolara-413b3.firebasestorage.app",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
