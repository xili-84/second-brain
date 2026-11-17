import { useEffect, useState } from 'react';

import { getAppUpdateState, subscribeToAppUpdates, type AppUpdateState } from './appUpdate';

export function useAppUpdate(): AppUpdateState {
  const [value, setValue] = useState(getAppUpdateState);

  useEffect(() => subscribeToAppUpdates(setValue), []);

  return value;
}
