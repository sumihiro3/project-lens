<template>
  <v-app>
    <v-app-bar title="ProjectLens" color="primary">
      <template v-slot:append>
        <v-btn icon="mdi-cog" to="/settings"></v-btn>
      </template>
    </v-app-bar>

    <v-navigation-drawer expand-on-hover rail>
      <v-list>
        <v-list-item prepend-icon="mdi-view-dashboard" title="Dashboard" to="/"></v-list-item>
        <v-list-item prepend-icon="mdi-cog" title="Settings" to="/settings"></v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-main>
      <NuxtPage />
    </v-main>
  </v-app>
</template>
