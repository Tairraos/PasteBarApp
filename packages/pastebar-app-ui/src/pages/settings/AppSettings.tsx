import { settingsStoreAtom, uiStoreAtom } from '~/store'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

import Spacer from '~/components/atoms/spacer'
import { Box, Button, Flex, Separator, Text } from '~/components/ui'

import { MainContainer } from '../../layout/Layout'

export default function AppSettingsPage() {
  const { returnRoute } = useAtomValue(uiStoreAtom)
  const { isSimplifiedLayout } = useAtomValue(settingsStoreAtom)
  const { t } = useTranslation()

  const settingsNavItems = [
    {
      to: '/app-settings/history',
      id: 'app-settings-history_tour',
      label: t('Clipboard', { ns: 'settings' }),
    },
    {
      to: '/app-settings/collections',
      id: 'app-settings-collections_tour',
      label: t('Collections', { ns: 'settings' }),
    },
    {
      to: '/app-settings/preferences',
      id: 'app-settings-preferences_tour',
      label: t('Preferences', { ns: 'settings' }),
    },
    {
      to: '/app-settings/backup-restore',
      id: 'app-settings-backup-restore_tour',
      label: t('Backup', { ns: 'settings' }),
    },
    {
      to: '/app-settings/security',
      id: 'app-settings-security_tour',
      label: t('Security', { ns: 'settings' }),
    },
  ]

  return (
    <MainContainer>
      <Box className="w-full">
        <Flex>
          <Box
            className={`${
              isSimplifiedLayout
                ? 'h-[calc(100vh-40px)]'
                : 'h-[calc(100vh-70px)] shadow-sm rounded-xl'
            } flex w-[90px] shrink-0 flex-col bg-slate-200 dark:bg-gray-800 dark:border-gray-700 dark:shadow-slate-700/[.8] py-6 px-1`}
          >
            <Box className="animate-in fade-in flex flex-col flex-1 min-h-0">
              {settingsNavItems.map(({ to, id, label }) => (
                <NavLink key={to} to={to} replace id={id}>
                  {({ isActive }) => (
                    <Text
                      className={`pr-2 text-right py-3 text-lg justify-end items-center animate fade-in transition-fonts duration-100 dark:!text-slate-400 ${
                        isActive &&
                        '!font-bold text-[19px] dark:!text-slate-300 !_text-slate-600'
                      }`}
                    >
                      {label}
                    </Text>
                  )}
                </NavLink>
              ))}

              <Box className="mt-auto">
                <Spacer h={6} />
                <Flex className="justify-end">
                  <Separator decorative className="bg-gray-300 dark:bg-gray-600" />
                </Flex>
                <Spacer h={6} />
                <NavLink to={returnRoute} replace id="app-settings-back_tour">
                  <Box className="pr-2 text-right py-3 text-md animate fade-in transition-fonts duration-100">
                    <Button
                      variant="secondary"
                      className="text-sm bg-slate-200 dark:bg-slate-700 dark:text-slate-200 px-2"
                    >
                      {t('Back', { ns: 'common' })}
                    </Button>
                  </Box>
                </NavLink>
              </Box>
            </Box>
          </Box>
          <Box
            className={`${
              isSimplifiedLayout
                ? 'h-[calc(100vh-40px)]'
                : 'h-[calc(100vh-70px)] shadow-sm rounded-xl border-0'
            } flex flex-col flex-1 min-w-0 ${
              !isSimplifiedLayout
                ? 'bg-slate-50 dark:bg-gray-800 dark:border-gray-700 dark:shadow-slate-700/[.7]'
                : ''
            }`}
          >
            <Outlet />
          </Box>
        </Flex>
      </Box>
    </MainContainer>
  )
}
