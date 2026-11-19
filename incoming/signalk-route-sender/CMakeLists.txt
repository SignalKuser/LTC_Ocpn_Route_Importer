cmake_minimum_required(VERSION 3.16)

project(signalk_route_sender VERSION 0.5.6 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_subdirectory(opencpn-libs/api-21)

find_package(wxWidgets REQUIRED COMPONENTS core base net)
include(${wxWidgets_USE_FILE})

find_package(CURL REQUIRED)

set(ICON_FILE "${CMAKE_CURRENT_SOURCE_DIR}/assets/route-sender-icon.png")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${ICON_FILE}")
file(READ "${ICON_FILE}" ICON_HEX HEX)
string(REGEX REPLACE "(..)" "0x\\1," ICON_BYTES "${ICON_HEX}")
file(GENERATE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/route_sender_icon.h"
     CONTENT "constexpr unsigned char kRouteSenderIcon[] = {${ICON_BYTES}};\n")

add_library(signalk_route_sender_pi SHARED
    src/route_sender_pi.cpp
)

target_link_libraries(signalk_route_sender_pi
    PRIVATE
    ocpn::api
    ${wxWidgets_LIBRARIES}
    CURL::libcurl
)

target_include_directories(signalk_route_sender_pi
    PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/opencpn-libs/api-21
    ${CMAKE_CURRENT_BINARY_DIR}
)

if(MSVC AND WIN32)
    target_compile_definitions(signalk_route_sender_pi
        PRIVATE
            __WXMSW__
            _DISABLE_CONSTEXPR_MUTEX_CONSTRUCTOR
    )
    set_target_properties(signalk_route_sender_pi PROPERTIES
        PREFIX ""
        OUTPUT_NAME "signalk_route_sender_pi"
    )
else()
    set_target_properties(signalk_route_sender_pi PROPERTIES
        PREFIX "lib"
        OUTPUT_NAME "signalk_route_sender_pi"
    )
endif()
