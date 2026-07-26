import { createContext, useState, useEffect, useContext } from 'react';
import localforage from 'localforage';

export const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [activeBookId, setActiveBookId] = useState('book_main');

  useEffect(() => {
    localforage.getItem('activeBookId').then((id) => {
      if (id) setActiveBookId(id);
    });
  }, []);

  const changeActiveBookId = async (id) => {
    setActiveBookId(id);
    await localforage.setItem('activeBookId', id);
  };

  return (
    <AppContext.Provider value={{ activeBookId, setActiveBookId: changeActiveBookId }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
